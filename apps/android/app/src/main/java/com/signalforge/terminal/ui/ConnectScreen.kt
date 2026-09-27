package com.signalforge.terminal.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ConnectScreen(
    url: String,
    token: String,
    error: String?,
    onUrl: (String) -> Unit,
    onToken: (String) -> Unit,
    onConnect: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("SIGNALFORGE", color = Blue, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Text("Android terminal", color = Text, fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "This app talks to a SignalForge engine you already run. Luno and xAI keys stay on that server. They are not entered or stored on the phone.",
            color = Muted,
        )
        OutlinedTextField(
            value = url,
            onValueChange = onUrl,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Engine URL") },
            placeholder = { Text("http://192.168.1.20:8787") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            colors = fieldColors(),
        )
        OutlinedTextField(
            value = token,
            onValueChange = onToken,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Access token") },
            placeholder = { Text("SIGNALFORGE_ACCESS_TOKEN") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            colors = fieldColors(),
        )
        Text(
            "On the engine host set SIGNALFORGE_BIND=0.0.0.0 and the same access token. An emulator reaches the host at http://10.0.2.2:8787. HTTP is allowed only for this device and private LAN addresses.",
            color = Muted,
            fontSize = 13.sp,
        )
        if (error != null) Text(error, color = Ask)
        Button(
            onClick = onConnect,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = ColorBidButton, contentColor = Text),
        ) {
            Text("Connect")
        }
    }
}

private val ColorBidButton = Bid.copy(alpha = 0.25f)

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Text,
    unfocusedTextColor = Text,
    focusedBorderColor = Blue,
    unfocusedBorderColor = Line,
    focusedLabelColor = Muted,
    unfocusedLabelColor = Muted,
    cursorColor = Blue,
)
