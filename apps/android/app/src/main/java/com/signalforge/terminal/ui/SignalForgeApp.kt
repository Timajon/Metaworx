package com.signalforge.terminal.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.signalforge.terminal.ApiResult
import com.signalforge.terminal.Dashboard
import com.signalforge.terminal.EngineApi
import com.signalforge.terminal.EngineEndpoint
import com.signalforge.terminal.SessionStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@Composable
fun SignalForgeApp(store: SessionStore, apiFactory: (String, String) -> EngineApi) {
    var session by remember { mutableStateOf(store.read()) }
    var url by remember { mutableStateOf(session?.baseUrl ?: "") }
    var token by remember { mutableStateOf("") }
    var connectError by remember { mutableStateOf<String?>(null) }
    var dashboard by remember { mutableStateOf<Dashboard?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    val scope = rememberCoroutineScope()
    val api = remember(session?.baseUrl, session?.token) {
        session?.let { apiFactory(it.baseUrl, it.token) }
    }

    LaunchedEffect(api) {
        val client = api ?: return@LaunchedEffect
        while (isActive) {
            try {
                dashboard = client.dashboard()
                loadError = null
            } catch (error: Exception) {
                loadError = error.message ?: "Engine unreachable"
            }
            delay(2_000)
        }
    }

    fun runAction(block: (EngineApi) -> ApiResult) {
        val client = api ?: return
        scope.launch {
            try {
                val result = block(client)
                notice = if (result.ok) {
                    val text = when {
                        result.orderId != null -> "Order ${result.orderId} accepted"
                        result.paused == true -> "New trades paused"
                        result.paused == false -> "New trades resumed"
                        else -> "Saved"
                    }
                    text to false
                } else {
                    (result.error ?: "Rejected") to true
                }
                dashboard = client.dashboard()
                loadError = null
            } catch (error: Exception) {
                notice = (error.message ?: "Action failed") to true
            }
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = Bg) {
        val current = session
        val client = api
        if (current == null || client == null) {
            ConnectScreen(
                url = url,
                token = token,
                error = connectError,
                onUrl = { url = it },
                onToken = { token = it },
                onConnect = {
                    val problem = EngineEndpoint.validate(url, token)
                    if (problem != null) {
                        connectError = problem
                    } else {
                        val normalized = EngineEndpoint.normalize(url)
                        val savedToken = token.trim()
                        store.write(normalized, savedToken)
                        session = SessionStore.Session(normalized, savedToken)
                        token = ""
                        connectError = null
                    }
                },
            )
        } else {
            TerminalScreen(
                baseUrl = current.baseUrl,
                dashboard = dashboard,
                loadError = loadError,
                notice = notice?.first,
                noticeIsError = notice?.second == true,
                onDisconnect = {
                    store.clear()
                    session = null
                    dashboard = null
                    notice = null
                    url = current.baseUrl
                },
                onSelectMarket = { marketId -> runAction { it.post("/api/market", mapOf("marketId" to marketId)) } },
                onPause = { paused -> runAction { it.post("/api/pause", mapOf("paused" to paused)) } },
                onOrder = { fields -> runAction { it.post("/api/orders", fields) } },
                onCancelOpen = { runAction { it.post("/api/controls/cancel-open", emptyMap()) } },
                onSellHoldings = { marketId, phrase ->
                    runAction { it.post("/api/controls/sell-holdings", mapOf("marketId" to marketId, "confirmation" to phrase)) }
                },
                onMode = { mode, phrase, hint ->
                    runAction { it.post("/api/mode", mapOf("mode" to mode, "confirmation" to phrase, "keyHint" to hint)) }
                },
                onConfirmProposal = { id -> runAction { it.post("/api/proposals/$id/confirm", emptyMap()) } },
                onRejectProposal = { id -> runAction { it.post("/api/proposals/$id/reject", emptyMap()) } },
            )
        }
    }
}
