package com.signalforge.terminal.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.signalforge.terminal.Dashboard
import com.signalforge.terminal.modeLabel
import com.signalforge.terminal.trimNumber

@Composable
fun TerminalScreen(
    baseUrl: String,
    dashboard: Dashboard?,
    loadError: String?,
    notice: String?,
    noticeIsError: Boolean,
    onDisconnect: () -> Unit,
    onSelectMarket: (String) -> Unit,
    onPause: (Boolean) -> Unit,
    onOrder: (Map<String, Any?>) -> Unit,
    onCancelOpen: () -> Unit,
    onSellHoldings: (String, String) -> Unit,
    onMode: (String, String, String) -> Unit,
    onConfirmProposal: (Long) -> Unit,
    onRejectProposal: (Long) -> Unit,
) {
    var side by rememberSaveable { mutableStateOf("BUY") }
    var type by rememberSaveable { mutableStateOf("MARKET") }
    var budget by rememberSaveable { mutableStateOf("1000") }
    var volume by rememberSaveable { mutableStateOf("0.001") }
    var price by rememberSaveable { mutableStateOf("") }
    var confirmLive by rememberSaveable { mutableStateOf(false) }
    var livePhrase by rememberSaveable { mutableStateOf("") }
    var keyHint by rememberSaveable { mutableStateOf("") }
    var sellPhrase by rememberSaveable { mutableStateOf("") }
    val data = dashboard

    Column(
        modifier = Modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 14.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("SIGNALFORGE", color = Blue, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp, fontSize = 12.sp)
                Text(baseUrl, color = Muted, fontSize = 11.sp)
            }
            Text(modeLabel(data?.mode ?: "paper"), color = modeColor(data?.mode ?: "paper"), fontWeight = FontWeight.Bold)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (data?.demo == true) "demo" else "credentialed", color = Muted, fontSize = 12.sp)
            Text("feed ${data?.feedStatus ?: "connecting"}", color = if (data?.feedStatus == "healthy") Bid else Amber, fontSize = 12.sp)
            TextButton("Disconnect", onDisconnect)
        }
        if (loadError != null) Text(loadError, color = Ask)
        if (data == null) {
            Text("Connecting to the engine…", color = Muted)
            return
        }
        data.warnings.take(3).forEach { warning -> Text(warning, color = Amber, fontSize = 12.sp) }
        CardSection {
            Text(data.selectedMarket, color = Text, fontWeight = FontWeight.SemiBold)
            Text(data.modeNote, color = Muted, fontSize = 12.sp)
            Text(data.candleSource, color = Muted, fontSize = 11.sp)
            CloseChart(data.candleCloses)
        }
        Text("ZAR markets", color = Muted, fontSize = 12.sp, letterSpacing = 1.sp)
        Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            data.markets.filter { it.counter == "ZAR" }.take(40).forEach { market ->
                val selected = market.id == data.selectedMarket
                Button(
                    onClick = { onSelectMarket(market.id) },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (selected) Color(0xFF172033) else Panel,
                        contentColor = Text,
                    ),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Column {
                        Text("${market.base}/${market.counter}", fontSize = 13.sp)
                        Text(trimNumber(market.last ?: "—"), color = Muted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                        Text(if (market.zarQuality == "exact") "ZAR" else market.zarQuality.ifBlank { market.status }, color = Muted, fontSize = 10.sp)
                    }
                }
            }
        }
        CardSection {
            Text("Book  ${data.spreadBps?.let { "spread %.2f bps".format(it) } ?: "spread —"}", color = Muted, fontSize = 12.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f)) {
                    data.bids.take(6).forEach { level ->
                        Text("${trimNumber(level.price)}  ${trimNumber(level.volume)}", color = Bid, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                    }
                }
                Column(Modifier.weight(1f)) {
                    data.asks.take(6).forEach { level ->
                        Text("${trimNumber(level.price)}  ${trimNumber(level.volume)}", color = Ask, fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                    }
                }
            }
            data.trades.take(5).forEach { trade ->
                Text(
                    "${if (trade.isBuy) "buy" else "sell"} ${trimNumber(trade.price)}  ${trimNumber(trade.volume)}",
                    color = if (trade.isBuy) Bid else Ask,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
        CardSection {
            Text("Order ticket", color = Muted, fontSize = 12.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Choice("BUY", side == "BUY") { side = "BUY" }
                Choice("SELL", side == "SELL") { side = "SELL" }
                Choice("MARKET", type == "MARKET") { type = "MARKET" }
                Choice("LIMIT", type == "LIMIT") { type = "LIMIT" }
            }
            if (type == "MARKET" && side == "BUY") {
                Field(budget, { budget = it }, "ZAR budget")
            } else {
                Field(volume, { volume = it }, "Base volume")
            }
            if (type == "LIMIT") Field(price, { price = it }, "Limit price")
            if (data.mode != "paper") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = confirmLive,
                        onCheckedChange = { confirmLive = it },
                        colors = CheckboxDefaults.colors(checkedColor = Amber),
                    )
                    Text("Confirm this live order", color = Amber, fontSize = 13.sp)
                }
            }
            Button(
                onClick = {
                    onOrder(
                        mapOf(
                            "marketId" to data.selectedMarket,
                            "side" to side,
                            "type" to type,
                            "quoteBudget" to budget.takeIf { type == "MARKET" && side == "BUY" },
                            "baseVolume" to volume.takeIf { !(type == "MARKET" && side == "BUY") },
                            "price" to price.takeIf { type == "LIMIT" && it.isNotBlank() },
                            "confirmLive" to (data.mode != "paper" && confirmLive),
                        ),
                    )
                },
                enabled = data.mode == "paper" || confirmLive,
                colors = ButtonDefaults.buttonColors(containerColor = Bid.copy(alpha = 0.28f), contentColor = Text),
            ) {
                Text(if (data.mode == "paper") "Submit paper order" else "Submit live order")
            }
            if (notice != null) Text(notice, color = if (noticeIsError) Ask else Bid)
        }
        CardSection {
            Text("Analysis", color = Muted, fontSize = 12.sp)
            Text(data.grokConnection, color = Muted, fontSize = 12.sp)
            data.analyses.take(3).forEach { item ->
                Text("${item.action} · ${item.source} · ${item.status}", color = Text, fontWeight = FontWeight.SemiBold)
                if (item.rationale.isNotBlank()) Text(item.rationale, color = Text, fontSize = 13.sp)
                Text("Cost ${item.costUsd} USD. ${item.costNote}", color = Muted, fontSize = 11.sp)
                if (item.uncalibratedScore != null) {
                    Text("Uncalibrated score ${item.uncalibratedScore}. This is not a probability of profit.", color = Amber, fontSize = 12.sp)
                }
            }
            data.proposals.forEach { proposal ->
                Text("${proposal.side} ${proposal.baseVolume} ${proposal.marketId}", color = Text)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton("Confirm") { onConfirmProposal(proposal.id) }
                    TextButton("Reject") { onRejectProposal(proposal.id) }
                }
            }
        }
        CardSection {
            Text("Controls", color = Muted, fontSize = 12.sp)
            TextButton(if (data.paused) "Resume new trades" else "Pause new trades") { onPause(!data.paused) }
            TextButton("Cancel open orders", onCancelOpen)
            Field(sellPhrase, { sellPhrase = it }, "Type SELL HOLDINGS")
            TextButton("Sell holdings") { onSellHoldings(data.selectedMarket, sellPhrase) }
            Field(livePhrase, { livePhrase = it }, "Type ENABLE LIVE TRADING")
            Field(keyHint, { keyHint = it }, "Last 4 of Luno key id")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton("Paper") { onMode("paper", livePhrase, keyHint) }
                TextButton("Assisted") { onMode("assisted_live", livePhrase, keyHint) }
            }
            TextButton("Automatic live") { onMode("automatic_live", livePhrase, keyHint) }
            Text(data.executionNote, color = Amber, fontSize = 12.sp)
        }
        CardSection {
            Text("Balances and exposure", color = Muted, fontSize = 12.sp)
            data.balances.forEach { balance ->
                Text("${balance.currency} (${balance.source})  ${trimNumber(balance.available)}", color = Text, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
            }
            data.positions.forEach { position ->
                Text("${position.marketId} ${trimNumber(position.qty)} · uPnL ${position.unrealized?.let(::trimNumber) ?: "—"}", color = Muted, fontSize = 12.sp)
            }
            Text("${trimNumber(data.exposureUsed)} / ${trimNumber(data.exposureMax)} ${data.exposureCurrency}", color = Text, fontWeight = FontWeight.SemiBold)
        }
        CardSection {
            Text("Performance", color = Muted, fontSize = 12.sp)
            Text("Trading P&L excludes the ${trimNumber(data.seed)} ZAR seed, deposits ${trimNumber(data.deposits)}, and withdrawals ${trimNumber(data.withdrawals)}.", color = Muted, fontSize = 12.sp)
            Text(trimNumber(data.tradingPnl), color = Text, fontSize = 22.sp, fontFamily = FontFamily.Monospace)
            Text(
                "Realized ${trimNumber(data.realized)} · Unrealized ${data.unrealized?.let(::trimNumber) ?: "—"} · Fees ${trimNumber(data.fees)} · Drawdown ${trimNumber(data.drawdown)}",
                color = Muted,
                fontSize = 12.sp,
            )
            Text("Grok API cost ${data.grokCostUsd} USD. ${data.grokCostNote}", color = Muted, fontSize = 12.sp)
        }
        CardSection {
            Text("Orders", color = Muted, fontSize = 12.sp)
            if (data.orders.isEmpty()) Text("No orders yet.", color = Muted)
            data.orders.take(8).forEach { order ->
                Text(
                    "${order.side} ${order.type} ${order.status}  ${trimNumber(order.filledBase)}/${trimNumber(order.baseVolume)}  fee ${trimNumber(order.feeQuote)} ${order.mode}",
                    color = Text,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

@Composable
private fun CardSection(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Panel, RoundedCornerShape(14.dp))
            .border(1.dp, Line, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        content()
    }
}

@Composable
private fun Choice(label: String, selected: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (selected) Blue.copy(alpha = 0.25f) else Panel,
            contentColor = Text,
        ),
        shape = RoundedCornerShape(8.dp),
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(label, fontSize = 12.sp)
    }
}

@Composable
private fun TextButton(label: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(containerColor = Panel, contentColor = Text),
        shape = RoundedCornerShape(8.dp),
    ) {
        Text(label)
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(label) },
        singleLine = true,
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = Text,
            unfocusedTextColor = Text,
            focusedBorderColor = Blue,
            unfocusedBorderColor = Line,
            focusedLabelColor = Muted,
            unfocusedLabelColor = Muted,
            cursorColor = Blue,
        ),
    )
}

@Composable
private fun CloseChart(closes: List<String>) {
    val values = closes.mapNotNull { close -> close.toDoubleOrNull() }
    if (values.size < 2) return
    Canvas(modifier = Modifier.fillMaxWidth().height(140.dp)) {
        val min = values.min()
        val max = values.max()
        val span = if (max == min) 1.0 else max - min
        val step = size.width / (values.lastIndex)
        val path = Path()
        values.forEachIndexed { index, value ->
            val x = index * step
            val y = size.height - (((value - min) / span).toFloat() * (size.height - 16f)) - 8f
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(path, color = Blue, style = Stroke(width = 3f))
        drawLine(Line, Offset(0f, size.height - 1f), Offset(size.width, size.height - 1f))
    }
}

private fun modeColor(mode: String) = when (mode) {
    "assisted_live" -> Amber
    "automatic_live" -> Ask
    else -> Bid
}
