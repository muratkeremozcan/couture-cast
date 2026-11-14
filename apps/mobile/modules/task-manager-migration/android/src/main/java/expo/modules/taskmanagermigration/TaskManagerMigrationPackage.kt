package expo.modules.taskmanagermigration

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Runs [PersistedTaskConsumers.dropUnloadable] from `Application.onCreate`, which Android runs
 * before any receiver, job service or activity of the process. expo-task-manager's TaskService,
 * which restores the persisted tasks, starts only in one of those components, so the cleanup
 * always runs first: on the upgrade broadcast, after a reboot and on a cold launch alike.
 */
class TaskManagerMigrationPackage : Package {
  override fun createApplicationLifecycleListeners(
    context: Context
  ): List<ApplicationLifecycleListener> = listOf(TaskManagerMigrationLifecycleListener())
}

class TaskManagerMigrationLifecycleListener : ApplicationLifecycleListener {
  override fun onCreate(application: Application) {
    PersistedTaskConsumers.dropUnloadable(application)
  }
}
