package com.signalforge.terminal

import org.json.JSONArray
import org.json.JSONObject

object DashboardParser {
    fun parse(body: String): Dashboard {
        val root = JSONObject(body)
        val feed = root.optJSONObject("feed") ?: JSONObject()
        val book = root.optJSONObject("book")
        val candles = root.optJSONObject("candles") ?: JSONObject()
        val performance = root.optJSONObject("performance") ?: JSONObject()
        val exposure = root.optJSONObject("exposure") ?: JSONObject()
        val connections = root.optJSONObject("connections") ?: JSONObject()
        return Dashboard(
            demo = root.optBoolean("demo"),
            mode = root.optString("mode", "paper"),
            paused = root.optBoolean("paused"),
            modeNote = root.optString("modeNote"),
            feedStatus = feed.optString("status", "starting"),
            feedError = feed.optString("lastError").ifBlank { null },
            selectedMarket = root.optString("selectedMarket"),
            markets = markets(root.optJSONArray("markets")),
            bids = levels(book?.optJSONArray("bids")),
            asks = levels(book?.optJSONArray("asks")),
            spreadBps = if (book != null && book.has("spreadBps") && !book.isNull("spreadBps")) book.optDouble("spreadBps") else null,
            trades = trades(root.optJSONArray("trades")),
            candleCloses = candleCloses(candles.optJSONArray("items")),
            candleSource = candles.optString("source"),
            analyses = analyses(root.optJSONArray("analyses")),
            proposals = proposals(root.optJSONArray("proposals")),
            orders = orders(root.optJSONArray("orders")),
            balances = balances(root.optJSONArray("balances")),
            positions = positions(root.optJSONArray("positions")),
            exposureUsed = exposure.optString("used", "0"),
            exposureMax = exposure.optString("max", "0"),
            exposureCurrency = exposure.optString("currency", "ZAR"),
            tradingPnl = performance.optString("tradingPnl", "0"),
            realized = performance.optString("realized", "0"),
            unrealized = performance.optString("unrealized").ifBlank { null },
            fees = performance.optString("fees", "0"),
            drawdown = performance.optString("drawdown", "0"),
            grokCostUsd = performance.optString("grokCostUsd", "0"),
            grokCostNote = performance.optString("grokCostNote"),
            seed = performance.optString("seed", "0"),
            deposits = performance.optString("deposits", "0"),
            withdrawals = performance.optString("withdrawals", "0"),
            warnings = strings(root.optJSONArray("warnings")),
            executionNote = root.optString("executionNote"),
            grokConnection = connections.optString("grok"),
        )
    }

    fun parseApiResult(status: Int, body: String): ApiResult {
        val json = try {
            JSONObject(body)
        } catch (_: Exception) {
            JSONObject()
        }
        val error = json.optString("error").ifBlank { null }
        val explicitOk = if (json.has("ok")) json.optBoolean("ok") else status in 200..299
        return ApiResult(
            httpStatus = status,
            ok = explicitOk && error == null,
            error = error,
            orderId = if (json.has("orderId") && !json.isNull("orderId")) json.optLong("orderId") else null,
            paused = if (json.has("paused")) json.optBoolean("paused") else null,
        )
    }

    private fun markets(array: JSONArray?): List<WatchItem> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            val zar = item.optJSONObject("zar")
            WatchItem(
                id = item.optString("id"),
                base = item.optString("base"),
                counter = item.optString("counter"),
                status = item.optString("status"),
                bid = item.optString("bid").ifBlank { null },
                ask = item.optString("ask").ifBlank { null },
                last = item.optString("last").ifBlank { null },
                zarQuality = zar?.optString("quality").orEmpty(),
            )
        }
    }

    private fun levels(array: JSONArray?): List<BookLevel> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            BookLevel(price = item.optString("price"), volume = item.optString("volume"))
        }
    }

    private fun trades(array: JSONArray?): List<TradeRow> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            TradeRow(price = item.optString("price"), volume = item.optString("volume"), isBuy = item.optBoolean("isBuy"))
        }
    }

    private fun candleCloses(array: JSONArray?): List<String> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index -> array.getJSONObject(index).optString("close") }.filter { it.isNotBlank() }
    }

    private fun analyses(array: JSONArray?): List<AnalysisRow> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            val proposal = item.optJSONObject("proposal")
            val score = if (proposal != null && proposal.has("uncalibrated_score") && !proposal.isNull("uncalibrated_score")) {
                proposal.optDouble("uncalibrated_score")
            } else {
                null
            }
            AnalysisRow(
                action = item.optString("action", "HOLD"),
                source = item.optString("source"),
                status = item.optString("status"),
                rationale = proposal?.optString("rationale").orEmpty().ifBlank { item.optString("reason") },
                costUsd = item.optString("costUsd", "0"),
                costNote = item.optString("costNote"),
                uncalibratedScore = score,
            )
        }
    }

    private fun proposals(array: JSONArray?): List<ProposalRow> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            ProposalRow(
                id = item.optLong("id"),
                marketId = item.optString("market_id"),
                side = item.optString("side"),
                baseVolume = item.optString("base_volume"),
                status = item.optString("status"),
            )
        }.filter { it.status == "pending" }
    }

    private fun orders(array: JSONArray?): List<OrderRow> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            OrderRow(
                side = item.optString("side"),
                type = item.optString("order_type"),
                status = item.optString("status"),
                filledBase = item.optString("filled_base"),
                baseVolume = item.optString("base_volume"),
                feeQuote = item.optString("fee_quote"),
                mode = item.optString("mode"),
            )
        }
    }

    private fun balances(array: JSONArray?): List<BalanceRow> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            BalanceRow(
                currency = item.optString("currency"),
                available = item.optString("available"),
                source = item.optString("source"),
            )
        }
    }

    private fun positions(array: JSONArray?): List<PositionRow> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            PositionRow(
                marketId = item.optString("marketId"),
                qty = item.optString("qty"),
                unrealized = item.optString("unrealized").ifBlank { null },
            )
        }
    }

    private fun strings(array: JSONArray?): List<String> {
        if (array == null) return emptyList()
        return (0 until array.length()).map { index -> array.optString(index) }.filter { it.isNotBlank() }
    }
}

fun modeLabel(mode: String): String = when (mode) {
    "paper" -> "PAPER"
    "assisted_live" -> "ASSISTED LIVE"
    "automatic_live" -> "AUTOMATIC LIVE"
    else -> mode.replace('_', ' ').uppercase()
}

fun trimNumber(raw: String): String {
    if (!raw.contains('.')) return raw
    val trimmed = raw.trimEnd('0').trimEnd('.')
    return trimmed.ifEmpty { "0" }
}
