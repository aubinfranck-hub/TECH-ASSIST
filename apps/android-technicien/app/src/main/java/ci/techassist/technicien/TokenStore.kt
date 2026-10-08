package ci.techassist.technicien

import android.content.Context

/** Jeton d'appareil du technicien : stockage privé de l'application (inaccessible aux autres applications). */
object TokenStore {
    private const val FILE = "technicien"
    private const val KEY = "token"
    private val FORMAT = Regex("^[A-Za-z0-9._-]{20,2000}$")

    fun get(context: Context): String? = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null)

    fun set(context: Context, token: String): Boolean {
        if (!FORMAT.matches(token)) return false
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, token).apply()
        return true
    }

    fun clear(context: Context) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().remove(KEY).apply()
    }
}
