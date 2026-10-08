package ci.techassist.technicien.core

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val ID1 = "11111111-1111-1111-1111-111111111111"
private const val ID2 = "22222222-2222-2222-2222-222222222222"

class SseParserTest {
    @Test fun `assemble les evenements coupes en morceaux et ignore les battements`() {
        val p = SseParser()
        assertEquals(emptyList<SseEvent>(), p.push(": ouvert\n\nevent: hel"))
        assertEquals(listOf(SseEvent("hello", "{\"a\":1}"), SseEvent("ping", "{}")), p.push("lo\ndata: {\"a\":1}\n\nevent: ping\ndata: {}\n\n"))
    }

    @Test fun `fins de ligne Windows`() {
        assertEquals(listOf(SseEvent("x", "1")), SseParser().push("event: x\r\ndata: 1\r\n\r\n"))
    }
}

class EventsTest {
    @Test fun `demande valide`() {
        val e = Events.parse(SseEvent("request", """{"type":"request","request":{"id":"$ID1","platform":"windows","who":"Awa","reason":"Micro","at":"2026-10-08T20:00:00Z"}}"""))
        assertEquals(StreamEvent.Request(WaitingRequest(ID1, "windows", "Awa", "Micro", "2026-10-08T20:00:00Z")), e)
    }

    @Test fun `identifiant invalide ou JSON casse  - ignore sans exception`() {
        assertNull(Events.parse(SseEvent("request", """{"request":{"id":"pas-un-uuid"}}""")))
        assertNull(Events.parse(SseEvent("request", "{pas du json")))
        assertNull(Events.parse(SseEvent("inconnu", "{}")))
    }

    @Test fun `file complete et pris`() {
        val s = Events.parse(SseEvent("snapshot", """{"queue":[{"id":"$ID1","platform":"android","who":"","reason":"","at":""},{"id":"x"}]}""")) as StreamEvent.Snapshot
        assertEquals(listOf(ID1), s.queue.map { it.id })
        assertEquals("Un client", s.queue[0].who)
        assertEquals(StreamEvent.Taken(ID1, "Kofi"), Events.parse(SseEvent("taken", """{"sessionId":"$ID1","by":"Kofi"}""")))
        assertEquals(StreamEvent.Hello(false), Events.parse(SseEvent("hello", """{"onDuty":false}""")))
    }
}

class AlertTrackerTest {
    private fun req(id: String) = WaitingRequest(id, "windows", "Awa", "", "")

    @Test fun `une nouvelle demande sonne une seule fois`() {
        val t = AlertTracker()
        assertEquals(listOf(AlertAction.Show(req(ID1))), t.onRequest(req(ID1)))
        assertEquals(emptyList<AlertAction>(), t.onRequest(req(ID1)))
        assertTrue(t.hasPending())
    }

    @Test fun `demande prise par un confrere  - l'alerte est retiree`() {
        val t = AlertTracker()
        t.onRequest(req(ID1))
        assertEquals(listOf(AlertAction.Cancel(ID1)), t.onTaken(ID1))
        assertFalse(t.hasPending())
        assertEquals(emptyList<AlertAction>(), t.onTaken(ID1))
    }

    @Test fun `la file complete rattrape une demande manquee et retire une alerte perimee, sans re-sonner`() {
        val t = AlertTracker()
        t.onRequest(req(ID1))
        val actions = t.onSnapshot(listOf(req(ID2)))
        assertEquals(setOf<AlertAction>(AlertAction.Cancel(ID1), AlertAction.Show(req(ID2))), actions.toSet())
        assertEquals(emptyList<AlertAction>(), t.onSnapshot(listOf(req(ID2))))
    }

    @Test fun `handle applique les evenements`() {
        val t = AlertTracker()
        var duty: Boolean? = null
        assertEquals(emptyList<AlertAction>(), t.handle(StreamEvent.Hello(true)) { duty = it })
        assertEquals(true, duty)
        assertEquals(1, t.handle(StreamEvent.Request(req(ID1))).size)
        assertEquals(listOf(AlertAction.Cancel(ID1)), t.clear())
    }
}

/** Le vrai client réseau contre un vrai serveur HTTP local qui parle comme l'API. */
class TechnicianStreamTest {
    private var server: HttpServer? = null
    private var stream: TechnicianStream? = null

    @After fun tearDown() {
        stream?.stop()
        server?.stop(0)
    }

    private fun serve(handler: (HttpExchange, Int) -> Unit): String {
        val s = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val hits = java.util.concurrent.atomic.AtomicInteger()
        s.createContext("/api/technician/stream") { ex ->
            try {
                handler(ex, hits.incrementAndGet())
            } finally {
                ex.close()
            }
        }
        s.start()
        server = s
        return "http://127.0.0.1:${s.address.port}"
    }

    private fun send(ex: HttpExchange, vararg frames: String, keepOpenMs: Long = 0) {
        ex.responseHeaders.add("Content-Type", "text/event-stream")
        ex.sendResponseHeaders(200, 0)
        for (f in frames) {
            ex.responseBody.write(f.toByteArray())
            ex.responseBody.flush()
        }
        if (keepOpenMs > 0) Thread.sleep(keepOpenMs)
    }

    private class Recorder(private val unauthorizedLatch: CountDownLatch? = null, private val eventsLatch: CountDownLatch? = null) : TechnicianStream.Listener {
        val events = CopyOnWriteArrayList<StreamEvent>()
        val states = CopyOnWriteArrayList<TechnicianStream.State>()
        @Volatile var unauthorized = false
        override fun onState(state: TechnicianStream.State) { states.add(state) }
        override fun onEvent(event: StreamEvent) { events.add(event); eventsLatch?.countDown() }
        override fun onUnauthorized() { unauthorized = true; unauthorizedLatch?.countDown() }
    }

    private fun start(base: String, rec: Recorder, token: String? = "T", timeout: Int = 5_000) {
        val s = TechnicianStream(base, { token }, rec, backoff = longArrayOf(10), readTimeoutMs = timeout)
        stream = s
        Thread { s.run() }.apply { isDaemon = true }.start()
    }

    @Test fun `recoit les evenements avec le jeton dans l'en-tete Authorization`() {
        var auth: String? = null
        val latch = CountDownLatch(2)
        val base = serve { ex, _ ->
            auth = ex.requestHeaders.getFirst("Authorization")
            send(ex, "event: hello\ndata: {\"onDuty\":true}\n\n", "event: request\ndata: {\"request\":{\"id\":\"$ID1\",\"platform\":\"windows\",\"who\":\"Awa\"}}\n\n", keepOpenMs = 1500)
        }
        val rec = Recorder(eventsLatch = latch)
        start(base, rec)
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertEquals("Bearer T", auth)
        assertEquals(StreamEvent.Hello(true), rec.events[0])
        assertEquals(ID1, (rec.events[1] as StreamEvent.Request).request.id)
        assertTrue(rec.states.contains(TechnicianStream.State.OPEN))
    }

    @Test fun `jeton refuse (401)  - on s'arrete et on le dit`() {
        val latch = CountDownLatch(1)
        val base = serve { ex, _ -> ex.sendResponseHeaders(401, -1) }
        val rec = Recorder(unauthorizedLatch = latch)
        start(base, rec)
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertTrue(rec.unauthorized)
        Thread.sleep(150)
        assertEquals(0, rec.events.size)
    }

    @Test fun `le serveur ferme la connexion  - reconnexion automatique`() {
        val latch = CountDownLatch(2)
        val base = serve { ex, n -> send(ex, "event: request\ndata: {\"request\":{\"id\":\"${if (n == 1) ID1 else ID2}\"}}\n\n") }
        val rec = Recorder(eventsLatch = latch)
        start(base, rec)
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertEquals(listOf(ID1, ID2), rec.events.map { (it as StreamEvent.Request).request.id })
        assertTrue(rec.states.contains(TechnicianStream.State.RETRYING))
    }

    @Test fun `silence trop long (connexion morte)  - on se reconnecte`() {
        val latch = CountDownLatch(1)
        val base = serve { ex, n ->
            if (n == 1) send(ex, ": ouvert\n\n", keepOpenMs = 3_000) // silence : le délai de lecture (300 ms) coupe
            else send(ex, "event: request\ndata: {\"request\":{\"id\":\"$ID1\"}}\n\n", keepOpenMs = 500)
        }
        val rec = Recorder(eventsLatch = latch)
        start(base, rec, timeout = 300)
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertNotNull(rec.events.firstOrNull())
    }

    @Test fun `sans jeton enregistre  - demande de reconnexion`() {
        val latch = CountDownLatch(1)
        val rec = Recorder(unauthorizedLatch = latch)
        start("http://127.0.0.1:1", rec, token = null)
        assertTrue(latch.await(3, TimeUnit.SECONDS))
    }

    @Test fun `stop() arrete la boucle meme en pleine attente`() {
        val base = serve { ex, _ -> send(ex, ": ouvert\n\n", keepOpenMs = 5_000) }
        val rec = Recorder()
        val s = TechnicianStream(base, { "T" }, rec, backoff = longArrayOf(10), readTimeoutMs = 10_000)
        val t = Thread { s.run() }.apply { isDaemon = true }
        t.start()
        Thread.sleep(300)
        s.stop()
        t.join(3_000)
        assertFalse(t.isAlive)
    }
}
