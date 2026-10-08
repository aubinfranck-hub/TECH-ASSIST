package ci.techassist.mobile

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiClient(private val baseUrl: String) {
    private fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        val c = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.setRequestProperty("Content-Type", "application/json")
        c.connectTimeout = 15000
        c.readTimeout = 30000
        if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) } }
        val text = (if (c.responseCode in 200..299) c.inputStream else c.errorStream).bufferedReader().use { it.readText() }
        if (c.responseCode !in 200..299) throw IllegalStateException(JSONObject(text).optString("error", "Erreur serveur"))
        return if (text.isBlank()) JSONObject() else JSONObject(text)
    }
    fun start(phone: String, problem: String) = request("POST", "/api/assistance/start", JSONObject().put("clientPhone", phone).put("problem", problem).put("platform", "android").put("requestedMode", "ia"))
    fun chat(id: String, code: String, message: String, initial: Boolean = false) = request("POST", "/api/sessions/$id/chat", JSONObject().put("sessionCode", code).put("message", message).put("initial", initial))
    fun feedback(id: String, code: String, procedureId: String?, result: String) = request("POST", "/api/sessions/$id/ai-feedback", JSONObject().put("sessionCode", code).put("procedureId", procedureId).put("result", result))
    fun escalate(id: String, code: String) = request("POST", "/api/sessions/$id/escalate", JSONObject().put("sessionCode", code))
    fun stop(id: String, code: String) = request("POST", "/api/sessions/$id/stop", JSONObject().put("sessionCode", code).put("stoppedBy", "client"))
    fun session(code: String) = request("GET", "/api/sessions/$code")
    fun messages(id: String, code: String) = request("GET", "/api/sessions/$id/messages?sessionCode=$code")
    fun sendMessage(id: String, code: String, message: String) =
        request("POST", "/api/sessions/$id/messages", JSONObject().put("sessionCode", code).put("message", message))
    fun remoteBootstrap(code: String) = request("GET", "/api/sessions/$code/remote-bootstrap")
    fun pairRemote(id: String, peerId: String, password: String, token: String) =
        request("POST", "/api/sessions/$id/pair", JSONObject().put("remotePeerId", peerId).put("remotePassword", password).put("bootstrapToken", token))
}