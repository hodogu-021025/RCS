import java.util.Properties

plugins {
    id("com.android.application")
}

// 서명 키 정보는 저장소에 넣지 않는다: android/keystore.properties (git 제외)에 storeFile·storePassword·keyAlias·keyPassword 를 적는다
val keyProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.sayloorder.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.sayloorder.app"
        minSdk = 21
        targetSdk = 35
        // 앱을 새로 만들어 올릴 때마다 versionCode 를 1씩 올린다 (같거나 낮으면 휴대폰이 업데이트로 받지 않는다)
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        create("release") {
            if (keyProps.isNotEmpty()) {
                storeFile = file(keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // 구글의 Trusted Web Activity 도우미: 크롬(또는 삼성 인터넷 등)으로 사이트를 주소창 없이 연다
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
