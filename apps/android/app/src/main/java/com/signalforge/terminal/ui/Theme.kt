package com.signalforge.terminal.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Bg = Color(0xFF090C11)
val Panel = Color(0xFF131B26)
val Line = Color(0xFF243140)
val Text = Color(0xFFE7EEF8)
val Muted = Color(0xFF8EA0B5)
val Bid = Color(0xFF3DDC97)
val Ask = Color(0xFFFF5D73)
val Amber = Color(0xFFF0B429)
val Blue = Color(0xFF8EB6FF)

private val colors = darkColorScheme(
    primary = Bid,
    onPrimary = Color(0xFF062117),
    secondary = Blue,
    background = Bg,
    surface = Panel,
    onBackground = Text,
    onSurface = Text,
    error = Ask,
    outline = Line,
)

@Composable
fun SignalForgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}
