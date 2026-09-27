package com.signalforge.terminal

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SessionStore(context: Context) {
    data class Session(val baseUrl: String, val token: String)

    private val preferences = EncryptedSharedPreferences.create(
        context,
        FILE_NAME,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun read(): Session? {
        val url = preferences.getString(KEY_URL, null)?.trim().orEmpty()
        if (url.isEmpty()) return null
        return Session(url, preferences.getString(KEY_TOKEN, "").orEmpty())
    }

    fun write(baseUrl: String, token: String) {
        preferences.edit().putString(KEY_URL, baseUrl).putString(KEY_TOKEN, token).apply()
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val FILE_NAME = "signalforge.session"
        const val KEY_URL = "engine_url"
        const val KEY_TOKEN = "access_token"
    }
}
