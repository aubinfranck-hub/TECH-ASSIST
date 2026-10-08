package ci.techassist.technicien

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.net.Uri
import ci.techassist.technicien.core.WaitingRequest

/** Notifications : l'alerte « ding-dong » d'une demande de client, l'état de la connexion, la reconnexion nécessaire. */
object Notifier {
    const val CH_REQUESTS = "demandes_v1"
    const val CH_STATUS = "etat_v1"
    const val STATUS_ID = 1
    const val RECONNECT_ID = 2
    const val EXTRA_SESSION = "session"

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        val sound = Uri.parse("android.resource://${context.packageName}/${R.raw.dingdong}")
        val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        nm.createNotificationChannel(
            NotificationChannel(CH_REQUESTS, "Demandes de clients", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Sonne dès qu'un client demande un technicien (comme tous vos confrères, en même temps)."
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 800)
                setSound(sound, attrs)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_STATUS, "État de la connexion", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Indique que l'application reste à l'écoute des demandes."
                setShowBadge(false)
            },
        )
    }

    private fun openIntent(context: Context, session: String?, code: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (session != null) putExtra(EXTRA_SESSION, session)
        }
        return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Alerte d'une demande. Le même identifiant remplace l'alerte précédente (pas de doublon) ; `remind` la fait re-sonner. */
    fun showRequest(context: Context, r: WaitingRequest, pendingCount: Int = 1, remind: Boolean = false) {
        val platform = if (r.platform == "android") "Android" else "Windows"
        val more = if (pendingCount > 1) " (+${pendingCount - 1} autre${if (pendingCount > 2) "s" else ""})" else ""
        val text = "${r.who} · $platform — ${r.reason.ifBlank { "demande un technicien" }}"
        val n = Notification.Builder(context, CH_REQUESTS)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(if (remind) "Toujours en attente : un client" + more else "Un client demande un technicien$more")
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(false)
            .setAutoCancel(true)
            .setContentIntent(openIntent(context, r.id, r.id.hashCode()))
            .addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_stat), "Ouvrir", openIntent(context, r.id, r.id.hashCode() + 1)).build())
            .build()
        context.getSystemService(NotificationManager::class.java).notify(r.id.hashCode(), n)
    }

    fun cancelRequest(context: Context, id: String) {
        context.getSystemService(NotificationManager::class.java).cancel(id.hashCode())
    }

    fun status(context: Context, text: String): Notification =
        Notification.Builder(context, CH_STATUS)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Tech Assist Technicien")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(openIntent(context, null, 0))
            .build()

    fun updateStatus(context: Context, text: String) {
        context.getSystemService(NotificationManager::class.java).notify(STATUS_ID, status(context, text))
    }

    fun reconnectNeeded(context: Context) {
        val n = Notification.Builder(context, CH_REQUESTS)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Reconnexion nécessaire")
            .setContentText("Vous ne recevez plus les demandes de clients. Ouvrez l'application et connectez-vous.")
            .setAutoCancel(true)
            .setContentIntent(openIntent(context, null, 2))
            .build()
        context.getSystemService(NotificationManager::class.java).notify(RECONNECT_ID, n)
    }
}
