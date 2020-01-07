const totp = require("totp-generator");
import { Paths, Channels } from "../models";
import fetch, { Headers } from "node-fetch";
import {
  Subject,
  from,
  BehaviorSubject,
  fromEvent,
  merge,
  combineLatest,
  of,
  timer,
  throwError,
  Observable
} from "rxjs";
import {
  delay,
  map,
  tap,
  switchMap,
  catchError,
  withLatestFrom,
  filter,
  mapTo,
  distinctUntilChanged,
  scan,
  first,
  retryWhen,
  finalize,
  mergeMap
} from "rxjs/operators";
import WebSocket, { OpenEvent } from "ws";
import Pino from "pino";

export const genericRetryStrategy = ({
  maxRetryAttempts = 3,
  scalingDuration = 1000,
  excludedStatusCodes = [401]
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
    finalize(() => console.log("We are done!"))
  );
};

interface Credentials {
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

interface MetaHandshakeResponse {
  minimumVersion: string;
  clientId: string;
  supportedConnectionTypes: string[];
  advice: { interval: number; timeout: number; reconnect: string };
  channel: "/meta/handshake";
  id: string;
  version: string;
  successful: boolean;
}

interface MetaConnectResponse {
  advice: { interval: number; timeout: number; reconnect: string };
  channel: "/meta/connect";
  id: string;
  successful: boolean;
}

export type MetaResponse = MetaHandshakeResponse | MetaConnectResponse;

const MIN_INACTIVE_MINUTES = 30;
const MAX_INACTIVE_MINUTES = 60 * 24;
const SOCKET_URL = "wss://www.avanza.se/_push/cometd";

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
  addSubscription$ = new BehaviorSubject<{ channel: Channels; ids: string[] }>(
    null
  );
  subscriptions$ = this.addSubscription$.pipe(
    scan((acc, curr) => [...acc, curr], [])
  );
  messages$ = new Subject();

  private credentials$ = new BehaviorSubject<Credentials>(null);
  private authenticate$ = new BehaviorSubject<void>(null);
  private totpCode$ = this.credentials$.pipe(
    map(credentials => (credentials ? totp(credentials.totpSecret) : null))
  );
  authSession$ = new BehaviorSubject<
    { auth: AuthResponse; securityToken: string } & TwoFactorLoginResponse
  >(null);
  private socket$ = new WebSocket(SOCKET_URL);
  private onSocketOpen$ = fromEvent<{ type: "open" } & OpenEvent>(
    this.socket$,
    "open"
  );
  private onSocketMessage$ = fromEvent<MessageEvent>(this.socket$, "message");
  private onSocketClose$ = fromEvent<CloseEvent>(this.socket$, "close");
  private onSocketAuth$ = new Subject();
  private onSocketSend$ = new Subject();
  private socketMessageCount$ = new BehaviorSubject<number>(1);
  private socketClientId$ = new BehaviorSubject<string>(null);
  private isSocketAuth$ = new BehaviorSubject<boolean>(false);
  private isSocketOpen$ = merge(
    this.onSocketOpen$.pipe(mapTo(true)),
    this.onSocketClose$.pipe(mapTo(false))
  );
  private logger: Pino.BaseLogger;

  constructor(
    readonly credentials: Credentials,
    private readonly _authenticationTimeout = MAX_INACTIVE_MINUTES,
    readonly logLevel = "30"
  ) {
    this.logger = Pino({ name: "avanza service" });
    checkCredentials(credentials, _authenticationTimeout);
    this.credentials$.next(credentials);

    this.authenticate$
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
        tap(values => {
          this.logger.info(values, "auth session");
          this.authSession$.next(values);
        })
      )
      .subscribe();

    this.authSession$
      .pipe(
        filter(value => !!value),
        delay((this._authenticationTimeout - 1) * 60 * 1000),
        tap(() => {
          this.authenticate$.next();
        })
      )
      .subscribe();

    this.onSocketSend$
      .pipe(
        tap(() => {
          this.socketMessageCount$.next(this.socketMessageCount$.value + 1);
        })
      )
      .subscribe();

    this.onSocketAuth$
      .pipe(
        withLatestFrom(this.socketMessageCount$, this.authSession$),
        filter(([_, __, authSession]) => !!authSession),
        tap(([_, socketMessageCount, authSession]) => {
          this.onSocketSend$.next({
            advice: {
              timeout: 60000,
              interval: 0
            },
            channel: "/meta/handshake",
            ext: { subscriptionId: authSession.auth.pushSubscriptionId },
            id: socketMessageCount,
            minimumVersion: "1.0",
            supportedConnectionTypes: [
              "websocket",
              "long-polling",
              "callback-polling"
            ],
            version: "1.0"
          });
        })
      )
      .subscribe();

    combineLatest(this.isSocketOpen$, this.authSession$)
      .pipe(
        filter(([isSocketOpen, authSession]) => isSocketOpen && !!authSession),
        tap(() => {
          this.onSocketAuth$.next();
        })
      )
      .subscribe();

    this.onSocketSend$
      .pipe(
        tap(message => {
          this.socket$.send(JSON.stringify([message]));
        })
      )
      .subscribe();

    this.onSocketMessage$
      .pipe(
        withLatestFrom(this.socketMessageCount$, this.socketClientId$),
        tap(([response, socketMessageCount, socketClientId]) => {
          const messages: MetaResponse[] = JSON.parse(response.data);
          for (const message of messages) {
            switch (message.channel) {
              case "/meta/handshake":
                if (message.successful) {
                  this.socketClientId$.next(message.clientId);
                  this.onSocketSend$.next({
                    advice: { timeout: 0 },
                    channel: "/meta/connect",
                    clientId: message.clientId,
                    connectionType: "websocket",
                    id: socketMessageCount
                  });
                } else {
                  console.log("Should reconnect");
                }

                break;
              case "/meta/connect":
                this.isSocketAuth$.next(true);
                this.onSocketSend$.next({
                  channel: "/meta/connect",
                  clientId: socketClientId,
                  connectionType: "websocket",
                  id: socketMessageCount
                });
                break;

              default:
                this.messages$.next(message);
                break;
            }
          }
        })
      )
      .subscribe();

    combineLatest(
      this.addSubscription$,
      this.isSocketAuth$.pipe(distinctUntilChanged())
    )
      .pipe(
        filter(([subscription, isSocketAuth]) => subscription && isSocketAuth),
        withLatestFrom(this.socketMessageCount$, this.socketClientId$),
        map(([[subscription], count, clientId]) => {
          this.logger.info(
            { subscription, count, clientId },
            "adding subscription"
          );
          if (
            [Channels.ORDERS, Channels.DEALS, Channels.POSITIONS].includes(
              subscription.channel
            )
          ) {
            this.onSocketSend$.next({
              channel: "/meta/subscribe",
              clientId,
              id: count,
              subscription: `/${subscription?.channel}${subscription.ids.join(
                ","
              )}`
            });
          } else {
            for (const id of subscription.ids) {
              this.onSocketSend$.next({
                channel: "/meta/subscribe",
                clientId,
                id: count,
                subscription: `/${subscription?.channel}/${id}`
              });
            }
          }
        })
      )
      .subscribe();

    this.authenticate$.next();
  }

  call(method: string, path: string) {
    return new Promise((resolve, reject) => {
      combineLatest(
        of({
          method,
          path
        }),
        this.authSession$
      )
        .pipe(
          filter(([_, auth]) => !!auth),
          first(),
          switchMap(([{ method, path }, authSession]) =>
            from(
              request(path, {
                method,
                headers: {
                  "X-AuthenticationSession":
                    authSession.auth.authenticationSession,
                  "X-SecurityToken": authSession.securityToken
                }
              })
            ).pipe(map(response => response.json))
          ),
          tap(response => resolve(response)),
          catchError(err => {
            reject(err);
            return [];
          })
        )
        .subscribe();
    });
  }

  getInspirationLists = async () =>
    this.call("get", Paths.INSPIRATION_LIST_PATH.replace("{0}", ""));

  /**
   * Get all `positions` held by this user.
   */
  getPositions = async () => this.call("get", Paths.POSITIONS_PATH);

  /**
   * Get an overview of the users holdings at Avanza Bank.
   */
  getOverview = async () => this.call("get", Paths.OVERVIEW_PATH);

  getAccountOverview(accountId: string) {
    const path = Paths.ACCOUNT_OVERVIEW_PATH.replace("{0}", accountId);
    return this.call("GET", path);
  }

  getDealsAndOrders() {
    return this.call("GET", Paths.DEALS_AND_ORDERS_PATH);
  }
}
