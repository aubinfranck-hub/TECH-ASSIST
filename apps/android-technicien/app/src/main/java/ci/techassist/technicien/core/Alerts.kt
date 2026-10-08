package ci.techassist.technicien.core

sealed class AlertAction {
    data class Show(val request: WaitingRequest) : AlertAction()
    data class Cancel(val id: String) : AlertAction()
}

/**
 * Suit les demandes en attente et dit quoi faire de l'écran : sonner pour une nouvelle demande, retirer l'alerte d'une demande prise par un
 * confrère. La « file complète » envoyée par le serveur rattrape ce qu'une coupure réseau a fait manquer (sans re-sonner pour une demande
 * déjà signalée).
 */
class AlertTracker {
    private val pending = LinkedHashMap<String, WaitingRequest>()

    @Synchronized fun pendingList(): List<WaitingRequest> = pending.values.toList()

    @Synchronized fun hasPending(): Boolean = pending.isNotEmpty()

    @Synchronized fun onRequest(r: WaitingRequest): List<AlertAction> {
        if (pending.containsKey(r.id)) return emptyList()
        pending[r.id] = r
        return listOf(AlertAction.Show(r))
    }

    @Synchronized fun onTaken(id: String): List<AlertAction> =
        if (pending.remove(id) != null) listOf(AlertAction.Cancel(id)) else emptyList()

    @Synchronized fun onSnapshot(queue: List<WaitingRequest>): List<AlertAction> {
        val out = ArrayList<AlertAction>()
        val ids = queue.map { it.id }.toSet()
        for (id in pending.keys.toList()) {
            if (id !in ids) {
                pending.remove(id)
                out.add(AlertAction.Cancel(id))
            }
        }
        for (r in queue) {
            if (!pending.containsKey(r.id)) {
                pending[r.id] = r
                out.add(AlertAction.Show(r))
            }
        }
        return out
    }

    @Synchronized fun clear(): List<AlertAction> {
        val out = pending.keys.map { AlertAction.Cancel(it) }
        pending.clear()
        return out
    }

    /** Applique un événement du flux et renvoie les actions à faire. */
    fun handle(event: StreamEvent, onDuty: (Boolean) -> Unit = {}): List<AlertAction> = when (event) {
        is StreamEvent.Request -> onRequest(event.request)
        is StreamEvent.Taken -> onTaken(event.sessionId)
        is StreamEvent.Snapshot -> onSnapshot(event.queue)
        is StreamEvent.Hello -> {
            onDuty(event.onDuty)
            emptyList()
        }
        StreamEvent.Ping -> emptyList()
    }
}
