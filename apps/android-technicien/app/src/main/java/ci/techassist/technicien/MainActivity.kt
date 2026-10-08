package ci.techassist.technicien

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

/**
 * La console Tech Assist dans une fenêtre plein écran (comme l'application Windows), plus le service d'alerte en arrière-plan.
 * La page prévient l'application de la connexion (jeton d'appareil de 30 jours) par l'interface « TechAssistApp ».
 */
class MainActivity : Activity() {
    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Notifier.ensureChannels(this)
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = userAgentString + " TechAssistTechnicien/1.0"
        }
        web.addJavascriptInterface(Bridge(), "TechAssistApp")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = handleLink(request.url)
        }
        if (TokenStore.get(this) != null) startAlerts()
        load(intent)
        askPermissionsOnce()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        load(intent)
    }

    private fun load(intent: Intent?) {
        val session = intent?.getStringExtra(Notifier.EXTRA_SESSION)?.takeIf { Regex("^[0-9a-fA-F-]{36}$").matches(it) }
        val token = TokenStore.get(this)
        // Le jeton passe dans le fragment (#…) : il n'est ni envoyé au serveur ni journalisé.
        val url = "${Config.SITE}/technicien?app=1" + (session?.let { "&session=$it" } ?: "") + (token?.let { "#token=$it" } ?: "")
        web.loadUrl(url)
    }

    /** Les pages du site restent dans l'application ; tout le reste (RustDesk, lien externe) s'ouvre dans l'application concernée. */
    private fun handleLink(uri: Uri): Boolean {
        // Seules les pages EXACTEMENT de notre site restent dans l'application (elle porte l'interface JavaScript du jeton).
        if ((uri.scheme == "https" || uri.scheme == "http") && uri.host == Uri.parse(Config.SITE).host) return false
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            if (uri.scheme == "rustdesk") {
                Toast.makeText(this, "Installez RustDesk pour vous connecter à l'écran du client.", Toast.LENGTH_LONG).show()
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.carriez.flutter_hbb")))
                } catch (_: ActivityNotFoundException) {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.carriez.flutter_hbb")))
                }
            }
        }
        return true
    }

    private fun startAlerts() {
        try {
            AlertService.start(this)
        } catch (_: Exception) {
            Toast.makeText(this, "Impossible de démarrer l'écoute en arrière-plan.", Toast.LENGTH_LONG).show()
        }
    }

    /** Interface JavaScript : la console prévient l'application quand le technicien se connecte ou se déconnecte. */
    inner class Bridge {
        @JavascriptInterface fun setToken(token: String) {
            if (TokenStore.set(applicationContext, token)) runOnUiThread { startAlerts() }
        }

        @JavascriptInterface fun clear() {
            TokenStore.clear(applicationContext)
            runOnUiThread { AlertService.stop(applicationContext) }
        }
    }

    private fun askPermissionsOnce() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        val prefs = getSharedPreferences("technicien", MODE_PRIVATE)
        val pm = getSystemService(PowerManager::class.java)
        if (!prefs.getBoolean("battery_asked", false) && !pm.isIgnoringBatteryOptimizations(packageName)) {
            prefs.edit().putBoolean("battery_asked", true).apply()
            AlertDialog.Builder(this)
                .setTitle("Rester en alerte")
                .setMessage("Pour sonner même écran éteint, Android doit autoriser Tech Assist Technicien à rester actif en arrière-plan. Appuyez sur « Autoriser » puis confirmez.")
                .setPositiveButton("Autoriser") { _, _ ->
                    try {
                        startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
                    } catch (_: Exception) {
                        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    }
                }
                .setNegativeButton("Plus tard", null)
                .show()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else moveTaskToBack(true) // l'application reste ouverte (et à l'écoute) en arrière-plan
    }
}
