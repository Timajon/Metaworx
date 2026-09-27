package com.signalforge.terminal

data class WatchItem(
    val id: String,
    val base: String,
    val counter: String,
    val status: String,
    val bid: String?,
    val ask: String?,
    val last: String?,
    val zarQuality: String,
)

data class BookLevel(val price: String, val volume: String)

data class TradeRow(val price: String, val volume: String, val isBuy: Boolean)

data class AnalysisRow(
    val action: String,
    val source: String,
    val status: String,
    val rationale: String,
    val costUsd: String,
    val costNote: String,
    val uncalibratedScore: Double?,
)

data class ProposalRow(
    val id: Long,
    val marketId: String,
    val side: String,
    val baseVolume: String,
    val status: String,
)

data class OrderRow(
    val side: String,
    val type: String,
    val status: String,
    val filledBase: String,
    val baseVolume: String,
    val feeQuote: String,
    val mode: String,
)

data class BalanceRow(val currency: String, val available: String, val source: String)

data class PositionRow(val marketId: String, val qty: String, val unrealized: String?)

data class Dashboard(
    val demo: Boolean,
    val mode: String,
    val paused: Boolean,
    val modeNote: String,
    val feedStatus: String,
    val feedError: String?,
    val selectedMarket: String,
    val markets: List<WatchItem>,
    val bids: List<BookLevel>,
    val asks: List<BookLevel>,
    val spreadBps: Double?,
    val trades: List<TradeRow>,
    val candleCloses: List<String>,
    val candleSource: String,
    val analyses: List<AnalysisRow>,
    val proposals: List<ProposalRow>,
    val orders: List<OrderRow>,
    val balances: List<BalanceRow>,
    val positions: List<PositionRow>,
    val exposureUsed: String,
    val exposureMax: String,
    val exposureCurrency: String,
    val tradingPnl: String,
    val realized: String,
    val unrealized: String?,
    val fees: String,
    val drawdown: String,
    val grokCostUsd: String,
    val grokCostNote: String,
    val seed: String,
    val deposits: String,
    val withdrawals: String,
    val warnings: List<String>,
    val executionNote: String,
    val grokConnection: String,
)

data class ApiResult(
    val httpStatus: Int,
    val ok: Boolean,
    val error: String?,
    val orderId: Long?,
    val paused: Boolean?,
)

class EngineException(message: String) : Exception(message)
