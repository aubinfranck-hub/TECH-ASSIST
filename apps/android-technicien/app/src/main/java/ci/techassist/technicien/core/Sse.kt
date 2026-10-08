package ci.techassist.technicien.core

/** Un événement du flux temps réel du serveur (« event: … / data: … »). */
data class SseEvent(val event: String, val data: String)

/** Lecture d'un flux « text/event-stream » reçu par morceaux : renvoie les événements complets, garde le reste. */
class SseParser {
    private val buffer = StringBuilder()

    fun push(chunk: String): List<SseEvent> {
        buffer.append(chunk.replace("\r\n", "\n"))
        val out = ArrayList<SseEvent>()
        while (true) {
            val end = buffer.indexOf("\n\n")
            if (end < 0) break
            val raw = buffer.substring(0, end)
            buffer.delete(0, end + 2)
            var event = "message"
            val data = ArrayList<String>()
            for (line in raw.split("\n")) {
                if (line.startsWith(":")) continue // battement
                if (line.startsWith("event:")) event = line.substring(6).trim()
                else if (line.startsWith("data:")) data.add(line.substring(5).removePrefix(" "))
            }
            if (data.isNotEmpty()) out.add(SseEvent(event, data.joinToString("\n")))
        }
        return out
    }
}
