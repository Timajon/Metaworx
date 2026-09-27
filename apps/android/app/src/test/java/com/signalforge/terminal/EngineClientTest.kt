package com.signalforge.terminal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineClientTest {
    @Test
    fun rejectsPublicHttpAndTokensInsideTheUrl() {
        assertEquals(
            "Public engines must use HTTPS. HTTP is limited to this device and private LAN addresses.",
            EngineEndpoint.validate("http://signalforge.example", "token"),
        )
        assertEquals(
            "Put the access token in the token field, not in the URL.",
            EngineEndpoint.validate("https://user:secret@signalforge.example", "token"),
        )
        assertEquals(
            "This engine is not on this device. Enter the SIGNALFORGE_ACCESS_TOKEN.",
            EngineEndpoint.validate("http://192.168.1.20:8787", ""),
        )
        assertNull(EngineEndpoint.validate("http://127.0.0.1:8787", ""))
        assertNull(EngineEndpoint.validate("http://10.0.2.2:8787", "desk-token"))
        assertNull(EngineEndpoint.validate("https://signalforge.example", "desk-token"))
    }

    @Test
    fun parsesDashboardWithoutTreatingModelScoreAsProfit() {
        val dashboard = DashboardParser.parse(FIXTURE)
        assertEquals("XBTZAR", dashboard.selectedMarket)
        assertEquals("paper", dashboard.mode)
        assertEquals("HOLD", dashboard.analyses[0].action)
        assertEquals(0.42, dashboard.analyses[0].uncalibratedScore)
        assertEquals("demo-rules", dashboard.analyses[0].source)
        assertEquals(1, dashboard.proposals.size)
        assertEquals("BUY", dashboard.orders[0].side)
        assertEquals("9", dashboard.fees)
        assertEquals("100000", dashboard.seed)
        assertEquals("-10", dashboard.tradingPnl)
        assertEquals("PAPER", modeLabel(dashboard.mode))
        assertEquals("1.5", trimNumber("1.5000"))
    }

    @Test
    fun apiUsesTheBearerTokenAndDoesNotTreatARejectedOrderAsSuccess() {
        val transport = RecordingTransport()
        val api = EngineApi("http://127.0.0.1:8787", "desk-token", transport)
        assertEquals("healthy", api.dashboard().feedStatus)
        assertEquals("Bearer desk-token", transport.lastTokenHeader)
        assertEquals("/api/dashboard", transport.lastPath)
        val paused = api.post(
            "/api/orders",
            mapOf("marketId" to "XBTZAR", "side" to "BUY", "type" to "MARKET", "quoteBudget" to "1000", "confirmLive" to false),
        )
        assertFalse(paused.ok)
        assertTrue(paused.error!!.contains("paused"))
        assertTrue(transport.lastBody!!.contains("\"marketId\":\"XBTZAR\""))
        assertTrue(transport.lastBody!!.contains("\"quoteBudget\":\"1000\""))
        var rejected = false
        try {
            EngineApi("http://127.0.0.1:8787", "wrong", transport).dashboard()
        } catch (error: EngineException) {
            rejected = error.message!!.contains("access token")
        }
        assertTrue(rejected)
    }

    private class RecordingTransport : Transport {
        var lastTokenHeader: String? = null
        var lastPath: String? = null
        var lastBody: String? = null

        override fun exchange(baseUrl: String, token: String, method: String, path: String, body: String?): RawResponse {
            lastTokenHeader = if (token.isBlank()) null else "Bearer $token"
            lastPath = path
            lastBody = body
            if (token != "desk-token") return RawResponse(401, """{"error":"Unauthorized"}""")
            if (path == "/api/orders") {
                return RawResponse(200, """{"ok":false,"error":"New trades are paused. Resume trading before submitting another order."}""")
            }
            return RawResponse(200, FIXTURE)
        }
    }

    private companion object {
        const val FIXTURE = """
            {
              "demo": true,
              "mode": "paper",
              "paused": false,
              "modeNote": "DEMO MODE",
              "feed": {"status": "healthy", "lastError": null},
              "selectedMarket": "XBTZAR",
              "markets": [{"id": "XBTZAR", "base": "XBT", "counter": "ZAR", "status": "ACTIVE", "last": "1379900", "zar": {"quality": "exact"}}],
              "book": {"bids": [{"price": "1378900", "volume": "0.01"}], "asks": [{"price": "1379961", "volume": "0.02"}], "spreadBps": 0.14},
              "trades": [{"price": "1379961", "volume": "0.001", "isBuy": true}],
              "candles": {"source": "derived", "items": [{"close": "1379000"}, {"close": "1379961"}]},
              "analyses": [{"action": "HOLD", "source": "demo-rules", "status": "accepted", "costUsd": "0", "costNote": "not billed", "proposal": {"rationale": "Rules only", "uncalibrated_score": 0.42}}],
              "proposals": [{"id": 3, "market_id": "XBTZAR", "side": "BUY", "base_volume": "0.001", "status": "pending"}, {"id": 4, "market_id": "XBTZAR", "side": "BUY", "base_volume": "0.001", "status": "rejected"}],
              "orders": [{"side": "BUY", "order_type": "MARKET", "status": "filled", "filled_base": "0.001", "base_volume": "0.001", "fee_quote": "9", "mode": "paper"}],
              "balances": [{"currency": "ZAR", "available": "98491", "source": "paper"}],
              "positions": [{"marketId": "XBTZAR", "qty": "0.001", "unrealized": "-10"}],
              "exposure": {"used": "1378", "max": "10000", "currency": "ZAR"},
              "performance": {"tradingPnl": "-10", "realized": "0", "unrealized": "-10", "fees": "9", "drawdown": "10", "grokCostUsd": "0", "grokCostNote": "estimated", "seed": "100000", "deposits": "0", "withdrawals": "0"},
              "warnings": ["Demo mode ignores live-trading switches."],
              "connections": {"grok": "not configured — demo rules engine"},
              "executionNote": "Backend-managed exits need the engine online."
            }
        """
    }
}
