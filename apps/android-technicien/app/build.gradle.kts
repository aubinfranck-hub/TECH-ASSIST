plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun prop(name: String): String? = project.findProperty(name) as String?

android {
    namespace = "ci.techassist.technicien"
    compileSdk = 35

    defaultConfig {
        applicationId = "ci.techassist.technicien"
        minSdk = 26
        targetSdk = 35
        // Chaque fabrication a un numéro plus grand (obligatoire pour qu'Android accepte la mise à jour par-dessus la version installée).
        versionCode = prop("versionCode")?.toInt() ?: 1
        versionName = prop("versionName") ?: "1.0.0"
        buildConfigField("String", "SITE_URL", "\"${prop("siteUrl") ?: "https://tech-assist-web.onrender.com"}\"")
        buildConfigField("String", "API_URL", "\"${prop("apiUrl") ?: "https://tech-assist-api.onrender.com"}\"")
    }

    // Signature stable (obligatoire pour mettre à jour sans désinstaller) : fournie par la fabrication automatique via des secrets,
    // jamais enregistrée dans le dépôt (il est public). Sans secret, signature de débogage (la mise à jour exige alors de désinstaller).
    signingConfigs {
        if (prop("keystorePath") != null) {
            create("shared") {
                storeFile = file(prop("keystorePath")!!)
                storePassword = prop("keystorePassword")
                keyAlias = prop("keyAlias")
                keyPassword = prop("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            signingConfigs.findByName("shared")?.let { signingConfig = it }
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    // org.json existe dans Android ; pour les essais sur ordinateur il faut la même bibliothèque.
    testImplementation("org.json:json:20240303")
}
