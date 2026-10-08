package ci.techassist.technicien.core

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Connexion permanente au serveur (SSE) : reçoit les demandes au même instant que tous les techniciens. Se reconnecte toute seule
 * (1 s, 2 s, 5 s … 30 s). Le serveur envoie un battement toutes les 15 s : un silence de plus de [readTimeoutMs] veut dire que la
 * connexion est morte (réseau changé, veille) — on se reconnecte. Un jeton refusé (401/403) arrête tout : il faut se reconnecter.
 */
class TechnicianStream(
    private val apiBase: String,
    private val token: () -> String?,
    private val listener: Listener,
    private val backoff: LongArray = longArrayOf(1_000, 2_000, 5_000, 10_000, 30_000),
    private val readTimeoutMs: Int = 50_000,
) {
    enum class State { CONNECTING, OPEN, RETRYING }

    interface Listener {
        fun onState(state: State)
        fun onEvent(event: StreamEvent)
        fun onUnauthorized()
    }

    @Volatile private var stopped = false
    @Volatile private var connection: HttpURLConnection? = null

    fun stop() {
        stopped = true
        connection?.disconnect()
    }

    /** Bloque jusqu'à stop() ou jusqu'à un jeton refusé : à lancer dans un thread. */
    fun run() {
        var attempt = 0
        while (!stopped) {
            listener.onState(State.CONNECTING)
            try {
                val t = token()
                if (t == null) {
                    listener.onUnauthorized()
                    return
                }
                val c = URL("${apiBase.trimEnd('/')}/api/technician/stream").openConnection() as HttpURLConnection
                connection = c
                c.setRequestProperty("Authorization", "Bearer $t")
                c.setRequestProperty("Accept", "text/event-stream")
                c.connectTimeout = 15_000
                c.readTimeout = readTimeoutMs
                val code = c.responseCode
                if (code == 401 || code == 403) {
                    listener.onUnauthorized()
                    return
                }
                if (code != 200) throw IOException("HTTP $code")
                listener.onState(State.OPEN)
                attempt = 0
                val parser = SseParser()
                c.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                    val buf = CharArray(2048)
                    while (!stopped) {
                        val n = reader.read(buf)
                        if (n < 0) break
                        for (raw in parser.push(String(buf, 0, n))) Events.parse(raw)?.let(listener::onEvent)
                    }
                }
            } catch (_: Exception) {
                // coupure, délai ou lecture interrompue : on retente ci-dessous
            } finally {
                connection?.disconnect()
            }
            if (stopped) return
            listener.onState(State.RETRYING)
            pause(backoff[minOf(attempt, backoff.size - 1)])
            attempt++
        }
    }

    private fun pause(ms: Long) {
        val end = System.currentTimeMillis() + ms
        while (!stopped && System.currentTimeMillis() < end) Thread.sleep(minOf(50L, maxOf(1L, end - System.currentTimeMillis())))
    }
}
