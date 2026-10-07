package ci.techassist.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        phone=findViewById(R.id.phone); problem=findViewById(R.id.problem); start=findViewById(R.id.start)
        code=findViewById(R.id.code); status=findViewById(R.id.status); assistant=findViewById(R.id.assistant)
        resolved=findViewById(R.id.resolved); notResolved=findViewById(R.id.notResolved); escalate=findViewById(R.id.escalate); stop=findViewById(R.id.stop)
        remoteBox=findViewById(R.id.remoteBox); remotePeer=findViewById(R.id.remotePeer); remotePassword=findViewById(R.id.remotePassword)
        remoteShare=findViewById(R.id.remoteShare); remoteOpen=findViewById(R.id.remoteOpen)
        start.setOnClickListener { startSession() }
        resolved.setOnClickListener { feedback("resolved") }
        notResolved.setOnClickListener { feedback("not_resolved") }
        escalate.setOnClickListener { escalateSession() }
        stop.setOnClickListener { stopSession() }
        remoteOpen.setOnClickListener { openRustDesk() }
        remoteShare.setOnClickListener { shareRemote() }
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

    private fun stopSession() {
        io.execute {
            try { api.stop(sessionId!!,sessionCode!!); runOnUiThread { status.text="Session arrêtée."; stop.visibility=View.GONE; remoteBox.visibility=View.GONE } }
            catch(e:Exception){ runOnUiThread { Toast.makeText(this,e.message,Toast.LENGTH_LONG).show() } }
        }
    }
}