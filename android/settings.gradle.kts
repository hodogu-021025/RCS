// Saylo 안드로이드 앱: sayloorder.com 을 주소창 없이 여는 앱 (Trusted Web Activity). 빌드는 README 의 "안드로이드 앱 파일" 참고
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "saylo-android"
include(":app")
