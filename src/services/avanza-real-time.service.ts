import { Channels } from "../models";
import {
  BehaviorSubject,
  fromEvent,
  merge,
  combineLatest,
  ReplaySubject
} from "rxjs";
import {
  map,
  tap,
  withLatestFrom,
  filter,
  mapTo,
  distinctUntilChanged,
  scan
} from "rxjs/operators";
import WebSocket, { OpenEvent } from "ws";
import Pino from "pino";
import { SessionAuth } from "./avanza.service";

const SOCKET_URL = "wss://www.avanza.se/_push/cometd";

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

export class AvanzaRealTime {
  addSubscription$ = new BehaviorSubject<{ channel: Channels; ids: string[] }>(
    null
  );
  subscriptions$ = this.addSubscription$.pipe(
    scan((acc, curr) => [...acc, curr], [])
  );
  messages$ = new ReplaySubject();

  private socket$ = new WebSocket(SOCKET_URL);
  private onSocketOpen$ = fromEvent<{ type: "open" } & OpenEvent>(
    this.socket$,
    "open"
  );
  private onSocketMessage$ = fromEvent<MessageEvent>(this.socket$, "message");
  private onSocketClose$ = fromEvent<CloseEvent>(this.socket$, "close");
  private onSocketAuth$ = new ReplaySubject();
  private onSocketSend$ = new ReplaySubject();
  private socketMessageCount$ = new BehaviorSubject<number>(1);
  private socketClientId$ = new BehaviorSubject<string>(null);
  private isSocketAuth$ = new BehaviorSubject<boolean>(false);
  private isSocketOpen$ = merge(
    this.onSocketOpen$.pipe(mapTo(true)),
    this.onSocketClose$.pipe(mapTo(false))
  );

  authSession$ = new ReplaySubject<SessionAuth>();

  private logger: Pino.BaseLogger;

  constructor(readonly logLevel = "30") {
    this.logger = Pino({ name: "avanza real time service" });

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
        tap(([_, socketMessageCount, { pushSubscriptionId }]) => {
          this.onSocketSend$.next({
            advice: {
              timeout: 60000,
              interval: 0
            },
            channel: "/meta/handshake",
            ext: { subscriptionId: pushSubscriptionId },
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
  }
}
