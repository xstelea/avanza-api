const totp = require("totp-generator");
import {
  Paths,
  Transactions,
  InstrumentType,
  ChartDataPeriod
} from "../models";
import fetch, { Headers } from "node-fetch";
import {
  from,
  BehaviorSubject,
  merge,
  combineLatest,
  timer,
  throwError,
  Observable,
  ReplaySubject
} from "rxjs";
import {
  delay,
  map,
  tap,
  switchMap,
  withLatestFrom,
  filter,
  first,
  retryWhen,
  finalize,
  mergeMap
} from "rxjs/operators";
import Pino from "pino";
import { stringify } from "qs";

export const genericRetryStrategy = ({
  maxRetryAttempts = 3,
  scalingDuration = 1000,
  excludedStatusCodes = [401, 400]
}: {
  maxRetryAttempts?: number;
  scalingDuration?: number;
  excludedStatusCodes?: number[];
} = {}) => (attempts: Observable<any>) => {
  return attempts.pipe(
    mergeMap((error, i) => {
      console.log(error);

      const isExcludedErrorCode = excludedStatusCodes.includes(
        error.statusCode
      );

      const retryAttempt = i + 1;
      // if maximum number of retries have been met
      // or response is a status code we don't wish to retry, throw error
      if (retryAttempt > maxRetryAttempts || isExcludedErrorCode) {
        return throwError(JSON.stringify(error, null, 4));
      }

      console.log(
        `Attempt ${retryAttempt}: retrying in ${retryAttempt *
          scalingDuration}ms`
      );
      // retry after 1s, 2s, etc...
      return timer(retryAttempt * scalingDuration);
    }),
    finalize(() => console.log("Done retrying"))
  );
};

export interface Credentials {
  username: string;
  password: string;
  totp?: string;
  totpSecret: string;
}

interface TwoFactorLoginResponse {
  twoFactorLogin: {
    transactionId: string;
    method: "TOTP";
  };
}

interface AuthResponse {
  authenticationSession: string;
  pushSubscriptionId: string;
  customerId: string;
  registrationComplete: boolean;
}

export interface SessionAuth {
  securityToken: string;
  authenticationSession: string;
  pushSubscriptionId: string;
}

export const MIN_INACTIVE_MINUTES = 30;
export const MAX_INACTIVE_MINUTES = 60 * 24;

const request = async <Response>(
  path: string,
  {
    method = "get",
    body,
    headers = {}
  }: {
    method: string;
    body?: any;
    headers?: { [header: string]: string };
  }
): Promise<{ json: Response & { statusCode: number }; headers: Headers }> => {
  const url = `https://${Paths.BASE}${path}`;
  const response = await fetch(`${url}`, {
    method: method,
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });

  return {
    json: { statusCode: response.status, ...(await response.json()) },
    headers: response.headers
  };
};

const checkCredentials = (
  credentials: Credentials,
  authenticationTimeout: number
) => {
  if (!credentials.username) {
    throw "Missing credentials.username.";
  }
  if (!credentials.password) {
    throw "Missing credentials.password.";
  }
  if (
    !(
      authenticationTimeout >= MIN_INACTIVE_MINUTES &&
      authenticationTimeout <= MAX_INACTIVE_MINUTES
    )
  ) {
    throw `Session timeout not in range ${MIN_INACTIVE_MINUTES} - ${MAX_INACTIVE_MINUTES} minutes.`;
  }
};

export class Avanza {
  static generateTwoFactorAuthCode(secret: number): number {
    return totp(secret);
  }
  private authenticationTimeout$ = new BehaviorSubject<number>(
    MAX_INACTIVE_MINUTES
  );
  private onSetCredentials$ = new ReplaySubject<Credentials>();
  private credentials$ = combineLatest(
    this.onSetCredentials$,
    this.authenticationTimeout$
  ).pipe(
    tap(([credentials, authenticationTimeout]) =>
      checkCredentials(credentials, authenticationTimeout)
    ),
    map(([credentials]) => credentials)
  );
  private authenticate$ = new BehaviorSubject<void>(null);
  private totpCode$ = this.credentials$.pipe(
    map(credentials => (credentials ? totp(credentials.totpSecret) : null))
  );
  authSession$ = new BehaviorSubject<
    { auth: AuthResponse; securityToken: string } & TwoFactorLoginResponse
  >(null);

  setCredentials(credentials: Credentials) {
    this.onSetCredentials$.next(credentials);
  }

  async authenticate() {
    return this.authenticate$
      .pipe(
        withLatestFrom(this.credentials$),
        filter(([_, credentials]) => !!credentials),
        switchMap(([_, credentials]) =>
          from(
            request<TwoFactorLoginResponse>(Paths.AUTHENTICATION_PATH, {
              method: "post",
              body: {
                maxInactiveMinutes: this._authenticationTimeout,
                password: credentials.password,
                username: credentials.username
              }
            })
          ).pipe(
            tap(response => {
              if (response.json.statusCode !== 200) {
                throw response.json;
              }
            }),

            map(response => ({ ...credentials, ...response }))
          )
        ),
        withLatestFrom(this.totpCode$),
        switchMap(
          ([
            {
              json: { twoFactorLogin }
            },
            totpCode
          ]: any) => {
            return from(
              request<AuthResponse>(Paths.TOTP_PATH, {
                method: "post",
                body: { method: "TOTP", totpCode },
                headers: {
                  Cookie: `AZAMFATRANSACTION=${twoFactorLogin.transactionId}`
                }
              })
            ).pipe(
              tap(response => {
                if (response.json.statusCode !== 200) {
                  throw response.json;
                }
              }),
              map(({ json, headers }) => ({
                auth: { ...json },
                twoFactorLogin,
                securityToken: headers.get("x-securitytoken")
              }))
            );
          }
        ),
        retryWhen(
          genericRetryStrategy({ maxRetryAttempts: 10, scalingDuration: 10000 })
        ),
        map(authSession => ({
          securityToken: authSession.securityToken,
          authenticationSession: authSession.auth.authenticationSession,
          pushSubscriptionId: authSession.auth.pushSubscriptionId
        })),
        first()
      )
      .toPromise();
  }

  constructor(
    credentials?: Credentials,
    private readonly _authenticationTimeout = MAX_INACTIVE_MINUTES,
    readonly logLevel = "30"
  ) {
    if (credentials) {
      this.setCredentials(credentials);
    }

    merge(this.credentials$).subscribe();

    this.authSession$
      .pipe(
        filter(value => !!value),
        delay((this._authenticationTimeout - 1) * 60 * 1000),
        tap(() => {
          this.authenticate$.next();
        })
      )
      .subscribe();
  }

  call(method: string, path: string, sessionAuth: SessionAuth) {
    return request(path, {
      method,
      headers: {
        "X-AuthenticationSession": sessionAuth.authenticationSession,
        "X-SecurityToken": sessionAuth.securityToken
      }
    });
  }

  getInspirationLists = async (auth: SessionAuth) =>
    this.call("get", Paths.INSPIRATION_LIST_PATH.replace("{0}", ""), auth);

  /**
   * Get all `positions` held by this user.
   */
  getPositions = async (auth: SessionAuth) =>
    this.call("get", Paths.POSITIONS_PATH, auth);

  /**
   * Get an overview of the users holdings at Avanza Bank.
   */
  getOverview = async (auth: SessionAuth) =>
    this.call("get", Paths.OVERVIEW_PATH, auth);

  getAccountOverview(accountId: string, auth: SessionAuth) {
    const path = Paths.ACCOUNT_OVERVIEW_PATH.replace("{0}", accountId);
    return this.call("GET", path, auth);
  }

  getDealsAndOrders(auth: SessionAuth) {
    return this.call("GET", Paths.DEALS_AND_ORDERS_PATH, auth);
  }

  getTransactions(
    accountOrTransactionType: Transactions | string,
    options: Partial<{
      orderbookId: string[];
      from: string;
      to: string;
      maxAmount: number;
      minAmount: string;
    }>,
    auth: SessionAuth
  ) {
    const path = Paths.TRANSACTIONS_PATH.replace(
      "{0}",
      accountOrTransactionType
    );

    const query = stringify({
      ...options,
      orderbookId: (options.orderbookId ?? []).join(",")
    });
    return this.call("GET", query ? `${path}?${query}` : path, auth);
  }

  getInstrument(
    instrumentType: InstrumentType,
    instrumentId: string,
    auth: SessionAuth
  ) {
    const path = Paths.INSTRUMENT_PATH.replace(
      "{0}",
      instrumentType.toLowerCase()
    ).replace("{1}", instrumentId);
    return this.call("GET", path, auth);
  }

  getOrderbook(
    orderbookId: string,
    instrumentType: InstrumentType,
    auth: SessionAuth
  ) {
    const path = Paths.ORDERBOOK_PATH.replace(
      "{0}",
      instrumentType.toLowerCase()
    );
    const query = stringify({ orderbookId });
    return this.call("GET", `${path}?${query}`, auth);
  }

  getOrderbooks(orderbookIds: string[], auth: SessionAuth) {
    const ids = orderbookIds.join(",");
    const path = Paths.ORDERBOOK_LIST_PATH.replace("{0}", ids);
    const query = stringify({ sort: "name" });
    return this.call("GET", `${path}?${query}`, auth);
  }

  getChartdata(
    orderbookId: string,
    chartDataPeriod: ChartDataPeriod,
    auth: SessionAuth
  ) {
    const path = Paths.CHARTDATA_PATH.replace("{0}", orderbookId);
    const query = stringify({ timePeriod: chartDataPeriod });
    return this.call("GET", `${path}?${query}`, auth);
  }
}
