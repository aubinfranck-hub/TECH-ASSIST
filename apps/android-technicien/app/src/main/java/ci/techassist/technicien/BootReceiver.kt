package ci.techassist.technicien

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Au démarrage du téléphone (et après une mise à jour de l'application) : reprise de l'écoute si le technicien est connecté. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (TokenStore.get(context) != null) {
            try {
                AlertService.start(context)
            } catch (_: Exception) {
                // le système peut refuser un démarrage en arrière-plan : l'ouverture de l'application relancera l'écoute
            }
        }
    }
}
