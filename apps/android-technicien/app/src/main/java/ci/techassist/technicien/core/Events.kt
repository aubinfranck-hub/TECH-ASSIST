package ci.techassist.technicien.core

import org.json.JSONObject

/** Une demande de client en attente d'un technicien. */
data class WaitingRequest(val id: String, val platform: String, val who: String, val reason: String, val at: String)

sealed class StreamEvent {
    data class Hello(val onDuty: Boolean) : StreamEvent()
    data class Request(val request: WaitingRequest) : StreamEvent()
    data class Taken(val sessionId: String, val by: String) : StreamEvent()
    data class Snapshot(val queue: List<WaitingRequest>) : StreamEvent()
    object Ping : StreamEvent()
}

object Events {
    private val ID = Regex("^[0-9a-fA-F-]{36}$")

    private fun request(o: JSONObject): WaitingRequest? {
        val id = o.optString("id")
        if (!ID.matches(id)) return null
        return WaitingRequest(id, o.optString("platform"), o.optString("who", "Un client").ifBlank { "Un client" }, o.optString("reason"), o.optString("at"))
    }

    /** Événement du serveur compris, ou null s'il est inconnu ou mal formé (jamais d'exception : le flux continue). */
    fun parse(e: SseEvent): StreamEvent? = try {
        val o = JSONObject(e.data)
        when (e.event) {
            "hello" -> StreamEvent.Hello(o.optBoolean("onDuty", true))
            "request" -> o.optJSONObject("request")?.let(::request)?.let { StreamEvent.Request(it) }
            "taken" -> StreamEvent.Taken(o.optString("sessionId"), o.optString("by"))
            "snapshot" -> {
                val arr = o.optJSONArray("queue")
                val list = ArrayList<WaitingRequest>()
                if (arr != null) for (i in 0 until arr.length()) arr.optJSONObject(i)?.let(::request)?.let(list::add)
                StreamEvent.Snapshot(list)
            }
            "ping" -> StreamEvent.Ping
            else -> null
        }
    } catch (_: Exception) {
        null
    }
}
