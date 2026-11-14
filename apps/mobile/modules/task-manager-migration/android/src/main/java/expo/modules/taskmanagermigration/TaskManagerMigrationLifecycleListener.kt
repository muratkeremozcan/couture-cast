package expo.modules.taskmanagermigration

import android.app.Application
import expo.modules.core.interfaces.ApplicationLifecycleListener

/**
 * The cleanup TaskManagerMigrationPackage registers for `Application.onCreate`. Its own file, so
 * the standalone Robolectric project (android/unit-tests) compiles it without the Package
 * interface and the rest of expo-modules-core.
 */
class TaskManagerMigrationLifecycleListener : ApplicationLifecycleListener {
  override fun onCreate(application: Application) {
    PersistedTaskConsumers.dropUnloadable(application)
  }
}
