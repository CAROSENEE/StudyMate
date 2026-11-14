# Android notes

StudyMate is packaged with Capacitor. `capacitor.config.json` sets the application id and uses the synchronized `www/` directory. The native `MainActivity.java` delegates Android system-back navigation to the web app before exiting. The build script syncs current frontend assets and creates a debug APK. APK binaries and Gradle/SDK caches are excluded from this SRS reference package.
