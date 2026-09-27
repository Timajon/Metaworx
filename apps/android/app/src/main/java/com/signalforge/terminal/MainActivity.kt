package com.signalforge.terminal

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.signalforge.terminal.ui.SignalForgeApp
import com.signalforge.terminal.ui.SignalForgeTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val store = SessionStore(applicationContext)
        setContent {
            SignalForgeTheme {
                SignalForgeApp(store = store, apiFactory = { baseUrl, token -> EngineApi(baseUrl, token) })
            }
        }
    }
}
