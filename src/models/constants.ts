export enum Paths {
  BASE = "www.avanza.se",
  POSITIONS_PATH = "/_mobile/account/positions",
  OVERVIEW_PATH = "/_mobile/account/overview",
  ACCOUNT_OVERVIEW_PATH = "/_mobile/account/{0}/overview",
  DEALS_AND_ORDERS_PATH = "/_mobile/account/dealsandorders",
  WATCHLISTS_PATH = "/_mobile/usercontent/watchlist",
  WATCHLISTS_ADD_DELETE_PATH = "/_api/usercontent/watchlist/{0}/orderbooks/{1}",
  STOCK_PATH = "/_mobile/market/stock/{0}",
  FUND_PATH = "/_mobile/market/fund/{0}",
  CERTIFICATE_PATH = "/_mobile/market/certificate/{0}",
  INSTRUMENT_PATH = "/_mobile/market/{0}/{1}",
  ORDERBOOK_PATH = "/_mobile/order/{0}",
  ORDERBOOK_LIST_PATH = "/_mobile/market/orderbooklist/{0}",
  CHARTDATA_PATH = "/_mobile/chart/orderbook/{0}",
  ORDER_PLACE_DELETE_PATH = "/_api/order",
  ORDER_EDIT_PATH = "/_api/order/{0}/{1}",
  ORDER_GET_PATH = "/_mobile/order/{0}",
  SEARCH_PATH = "/_mobile/market/search/{0}",
  AUTHENTICATION_PATH = "/_api/authentication/sessions/usercredentials",
  TOTP_PATH = "/_api/authentication/sessions/totp",
  INSPIRATION_LIST_PATH = "/_mobile/marketing/inspirationlist/{0}",
  TRANSACTIONS_PATH = "/_mobile/account/transactions/{0}"
}

export enum Search {
  STOCK = "stock",
  FUND = "fund",
  BOND = "bond",
  OPTION = "option",
  FUTURE_FORWARD = "future_forward",
  CERTIFICATE = "certificate",
  WARRANT = "warrant",
  ETF = "exchange_traded_fund",
  INDEX = "index",
  PREMIUM_BOND = "premium_bond",
  SUBSCRIPTION_OPTION = "subscription_option",
  EQUITY_LINKED_BOND = "equity_linked_bond",
  CONVERTIBLE = "convertible"
}

export enum Chartdata {
  TODAY = "TODAY",
  ONE_MONTH = "ONE_MONTH",
  THREE_MONTHS = "THREE_MONTHS",
  ONE_WEEK = "ONE_WEEK",
  THIS_YEAR = "THIS_YEAR",
  ONE_YEAR = "ONE_YEAR",
  FIVE_YEARS = "FIVE_YEARS"
}

export enum Marketing {
  HIGHEST_RATED_FUNDS = "HIGHEST_RATED_FUNDS",
  LOWEST_FEE_INDEX_FUNDS = "LOWEST_FEE_INDEX_FUNDS",
  BEST_DEVELOPMENT_FUNDS_LAST_THREE_MONTHS = "BEST_DEVELOPMENT_FUNDS_LAST_THREE_MONTHS",
  MOST_OWNED_FUNDS = "MOST_OWNED_FUNDS"
}

export enum Transactions {
  OPTIONS = "options",
  FOREX = "forex",
  DEPOSIT_WITHDRAW = "deposit-withdraw",
  BUY_SELL = "buy-sell",
  DIVIDEND = "dividend",
  INTEREST = "interest",
  FOREIGN_TAX = "foreign-tax"
}

export enum Channels {
  ACCOUNTS = "accounts",
  QUOTES = "quotes",
  ORDERDEPTHS = "orderdepths",
  TRADES = "trades",
  BROKERTRADESUMMARY = "brokertradesummary",
  POSITIONS = "positions",
  ORDERS = "orders",
  DEALS = "deals"
}

export enum OrderType {
  BUY = "BUY",
  SELL = "SELL"
}
