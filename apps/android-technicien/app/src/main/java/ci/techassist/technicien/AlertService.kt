package ci.techassist.technicien

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import ci.techassist.technicien.core.AlertAction
import ci.techassist.technicien.core.AlertTracker
import ci.techassist.technicien.core.StreamEvent
import ci.techassist.technicien.core.TechnicianStream

/**
 * Service au premier plan : garde la connexion temps réel ouverte même application fermée, et fait sonner chaque nouvelle demande.
 * Une demande qui attend re-sonne chaque minute ; elle disparaît dès qu'un confrère la prend.
 */
class AlertService : Service(), TechnicianStream.Listener {
    private val tracker = AlertTracker()
    private var stream: TechnicianStream? = null
    private var onDuty = true
    private var state = TechnicianStream.State.CONNECTING
    private val handler = Handler(Looper.getMainLooper())

    private val reminder = object : Runnable {
        override fun run() {
            val pending = tracker.pendingList()
            if (pending.isNotEmpty()) Notifier.showRequest(this@AlertService, pending.first(), pending.size, remind = true)
            handler.postDelayed(this, REMIND_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Notifier.ensureChannels(this)
        val notification = Notifier.status(this, statusText())
        if (Build.VERSION.SDK_INT >= 34) startForeground(Notifier.STATUS_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(Notifier.STATUS_ID, notification)
        if (TokenStore.get(this) == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (stream == null) {
            val s = TechnicianStream(Config.API, { TokenStore.get(applicationContext) }, this)
            stream = s
            Thread({ s.run() }, "alertes-temps-reel").apply { isDaemon = true }.start()
            handler.postDelayed(reminder, REMIND_MS)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stream?.stop()
        stream = null
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun statusText(): String = when {
        state == TechnicianStream.State.OPEN && onDuty -> "En alerte : vous serez prévenu dès qu'un client demande de l'aide."
        state == TechnicianStream.State.OPEN -> "Connecté, mais hors permanence : vous ne recevez pas les alertes."
        else -> "Reconnexion en cours…"
    }

    // --- Événements du flux (thread réseau) ---

    override fun onState(state: TechnicianStream.State) {
        this.state = state
        Notifier.updateStatus(this, statusText())
    }

    override fun onEvent(event: StreamEvent) {
        val actions = tracker.handle(event) { duty ->
            onDuty = duty
            Notifier.updateStatus(this, statusText())
        }
        for (a in actions) {
            when (a) {
                is AlertAction.Show -> Notifier.showRequest(this, a.request, tracker.pendingList().size)
                is AlertAction.Cancel -> Notifier.cancelRequest(this, a.id)
            }
        }
    }

    override fun onUnauthorized() {
        TokenStore.clear(this)
        tracker.clear().forEach { if (it is AlertAction.Cancel) Notifier.cancelRequest(this, it.id) }
        Notifier.reconnectNeeded(this)
        stopSelf()
    }

    companion object {
        private const val REMIND_MS = 60_000L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, AlertService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AlertService::class.java))
        }
    }
}
