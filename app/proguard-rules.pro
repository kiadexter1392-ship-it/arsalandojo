# Add project specific ProGuard rules here.
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.example.ui.screens.AndroidDojoBridge {
    *;
}
-keep class com.google.firebase.appcheck.** {
    *;
}
-keep class com.google.firebase.ai.** {
    *;
}
-keep class com.google.android.recaptcha.** {
    *;
}

