package ci.techassist.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.*
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val api = ApiClient("https://tech-assist-api.onrender.com")
    private val io = Executors.newSingleThreadExecutor()
    private var sessionId: String? = null
    private var sessionCode: String? = null
    private var procedureId: String? = null
    private var bootstrapToken: String? = null
    private lateinit var phone: EditText
    private lateinit var problem: EditText
    private lateinit var start: Button
    private lateinit var code: TextView
    private lateinit var status: TextView
    private lateinit var assistant: TextView
    private lateinit var resolved: Button
    private lateinit var notResolved: Button
    private lateinit var escalate: Button
    private lateinit var stop: Button
    private lateinit var remoteBox: LinearLayout
    private lateinit var remotePeer: EditText
    private lateinit var remotePassword: EditText
    private lateinit var remoteShare: Button
    private lateinit var remoteOpen: Button
    private lateinit var technicianChat: LinearLayout
    private lateinit var technicianStatus: TextView
    private lateinit var technicianMessages: TextView
    private lateinit var technicianMessage: EditText
    private lateinit var sendTechnicianMessage: Button
    private val handler = Handler(Looper.getMainLooper())
    private var lastMessageId = 0L
    private var polling = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        phone=findViewById(R.id.phone); problem=findViewById(R.id.problem); start=findViewById(R.id.start)
        code=findViewById(R.id.code); status=findViewById(R.id.status); assistant=findViewById(R.id.assistant)
        resolved=findViewById(R.id.resolved); notResolved=findViewById(R.id.notResolved); escalate=findViewById(R.id.escalate); stop=findViewById(R.id.stop)
        remoteBox=findViewById(R.id.remoteBox); remotePeer=findViewById(R.id.remotePeer); remotePassword=findViewById(R.id.remotePassword)
        remoteShare=findViewById(R.id.remoteShare); remoteOpen=findViewById(R.id.remoteOpen)
        technicianChat=findViewById(R.id.technicianChat); technicianStatus=findViewById(R.id.technicianStatus)
        technicianMessages=findViewById(R.id.technicianMessages); technicianMessage=findViewById(R.id.technicianMessage)
        sendTechnicianMessage=findViewById(R.id.sendTechnicianMessage)
        start.setOnClickListener { startSession() }
        resolved.setOnClickListener { feedback("resolved") }
        notResolved.setOnClickListener { feedback("not_resolved") }
        escalate.setOnClickListener { escalateSession() }
        stop.setOnClickListener { stopSession() }
        remoteOpen.setOnClickListener { openRustDesk() }
        remoteShare.setOnClickListener { shareRemote() }
        sendTechnicianMessage.setOnClickListener { sendTechnicianMessage() }
    }

    private fun startSession() {
        val p=phone.text.toString().trim(); val issue=problem.text.toString().trim()
        if(p.length<8 || issue.isBlank()){ Toast.makeText(this,"Téléphone et problème obligatoires",Toast.LENGTH_SHORT).show(); return }
        start.isEnabled=false; status.text="Connexion à TechAssist IA…"
        io.execute {
            try {
                val r=api.start(p,issue); val s=r.getJSONObject("session")
                sessionId=s.getString("id"); sessionCode=s.getString("session_code")
                runOnUiThread {
                    code.text="Code de session : $sessionCode"; status.text="🤖 TechAssist IA analyse votre problème…"
                    start.visibility=View.GONE; phone.visibility=View.GONE; problem.visibility=View.GONE
                    resolved.visibility=View.VISIBLE; notResolved.visibility=View.VISIBLE; escalate.visibility=View.VISIBLE; stop.visibility=View.VISIBLE
                }
                val answer=api.chat(sessionId!!,sessionCode!!,issue,true)
                runOnUiThread { assistant.text=answer.optString("answer","Aucune réponse"); procedureId=answer.optString("procedureId",null) }
            } catch(e:Exception){ runOnUiThread { start.isEnabled=true; status.text="Erreur : \${e.message}" } }
        }
    }

    private fun feedback(result:String) {
        io.execute {
            try {
                val r=api.feedback(sessionId!!,sessionCode!!,procedureId,result)
                runOnUiThread {
                    when(r.optString("status")){
                        "technician" -> {
                            status.text="👨‍🔧 Votre dossier est transmis à un technicien."
                            assistant.text="Un technicien reprend votre dossier avec l'historique IA."
                            remoteBox.visibility=View.VISIBLE
                            technicianChat.visibility=View.VISIBLE
                            startTechnicianPolling()
                        }
                        "resolved" -> {
                            status.text="✓ Assistance terminée."
                            resolved.visibility=View.GONE; notResolved.visibility=View.GONE; escalate.visibility=View.GONE; remoteBox.visibility=View.GONE
                        }
                        else -> { assistant.text=r.optString("answer",assistant.text.toString()) }
                    }
                }
            } catch(e:Exception){ runOnUiThread { Toast.makeText(this,e.message,Toast.LENGTH_LONG).show() } }
        }
    }

    private fun escalateSession() {
        io.execute {
            try {
                api.escalate(sessionId!!,sessionCode!!)
                runOnUiThread {
                    status.text="👨‍🔧 Demande envoyée à la file technicien."
                    assistant.text="Votre dossier et l'historique sont transmis au technicien."
                    remoteBox.visibility=View.VISIBLE
                    technicianChat.visibility=View.VISIBLE
                    startTechnicianPolling()
                }
            } catch(e:Exception){ runOnUiThread { Toast.makeText(this,e.message,Toast.LENGTH_LONG).show() } }
        }
    }

    private fun openRustDesk() {
        try {
            startActivity(packageManager.getLaunchIntentForPackage("com.carriez.flutter_hbb") ?: Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.carriez.flutter_hbb")))
        } catch(e:Exception) {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.carriez.flutter_hbb")))
        }
    }

    private fun shareRemote() {
        val peer=remotePeer.text.toString().replace(" ","").trim()
        val pass=remotePassword.text.toString().trim()
        if(peer.length !in 6..12 || !peer.all { it.isDigit() } || pass.length < 4) {
            Toast.makeText(this,"ID RustDesk et mot de passe invalides",Toast.LENGTH_SHORT).show(); return
        }
        remoteShare.isEnabled=false
        io.execute {
            try {
                val bootstrap=api.remoteBootstrap(sessionCode!!)
                bootstrapToken=bootstrap.getString("bootstrapToken")
                api.pairRemote(sessionId!!,peer,pass,bootstrapToken!!)
                runOnUiThread {
                    remoteShare.isEnabled=true
                    remoteShare.text="✓ TÉLÉPHONE PARTAGÉ"
                    status.text="🔐 Connexion distante préparée. Le technicien peut maintenant se connecter."
                    Toast.makeText(this,"Le technicien peut se connecter. Acceptez sa demande dans RustDesk.",Toast.LENGTH_LONG).show()
                }
            } catch(e:Exception) {
                runOnUiThread { remoteShare.isEnabled=true; Toast.makeText(this,e.message,Toast.LENGTH_LONG).show() }
            }
        }
    }

    private fun sendTechnicianMessage() {
        val text = technicianMessage.text.toString().trim()
        if (text.isBlank() || sessionId == null || sessionCode == null) return
        sendTechnicianMessage.isEnabled=false
        io.execute {
            try {
                api.sendMessage(sessionId!!, sessionCode!!, text)
                runOnUiThread { technicianMessage.setText(""); sendTechnicianMessage.isEnabled=true; pollTechnicianMessages() }
            } catch(e:Exception) {
                runOnUiThread { sendTechnicianMessage.isEnabled=true; Toast.makeText(this, e.message ?: "Message non envoyé", Toast.LENGTH_LONG).show() }
            }
        }
    }

    private fun startTechnicianPolling() {
        if (polling) return
        polling=true
        pollTechnicianMessages()
    }

    private fun pollTechnicianMessages() {
        if (!polling || sessionId == null || sessionCode == null) return
        io.execute {
            try {
                val session = api.session(sessionCode!!).getJSONObject("session")
                val state = session.optString("status")
                val messages = api.messages(sessionId!!, sessionCode!!).getJSONArray("messages")
                val lines = StringBuilder()
                var maxId = lastMessageId
                for (i in 0 until messages.length()) {
                    val m = messages.getJSONObject(i)
                    val id = m.optLong("id")
                    maxId = maxOf(maxId, id)
                    val sender = when(m.optString("sender")) {
                        "technician" -> "Technicien"
                        "system" -> "TechAssist"
                        "client" -> "Vous"
                        else -> m.optString("sender")
                    }
                    lines.append(sender).append(" : ").append(m.optString("body")).append("\n\n")
                }
                lastMessageId=maxId
                runOnUiThread {
                    technicianStatus.text = when(state) {
                        "active" -> "🟢 Technicien connecté — vous pouvez échanger avec lui."
                        "waiting_technician", "created" -> "🟠 Votre demande est dans la file technicien."
                        "completed", "expired", "cancelled" -> { polling=false; "✓ Assistance terminée." }
                        else -> "État : $state"
                    }
                    technicianMessages.text=lines.toString()
                }
            } catch(_:Exception) { /* une coupure réseau temporaire ne ferme pas la session */ }
            if (polling) handler.postDelayed({ pollTechnicianMessages() }, 3000)
        }
    }

    private fun stopSession() {
        polling=false
        io.execute {
            try { api.stop(sessionId!!,sessionCode!!); runOnUiThread { polling=false; status.text="Session arrêtée."; stop.visibility=View.GONE; remoteBox.visibility=View.GONE; technicianChat.visibility=View.GONE } }
            catch(e:Exception){ runOnUiThread { Toast.makeText(this,e.message,Toast.LENGTH_LONG).show() } }
        }
    }
}