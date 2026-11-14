package expo.modules.taskmanagermigration

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * expo-task-manager persists every registered task in the `TaskManagerModule` SharedPreferences,
 * one JSON string per app scope key: `{"appUrl": ..., "tasks": {name: {"consumerClass": ...}}}`.
 * The first TaskService of a process restores them with `Class.forName` before any JS runs. A
 * consumer class the app no longer ships (Story 6.15 dropped expo-background-fetch, so an
 * upgraded install still lists `expo.modules.backgroundfetch.BackgroundFetchTaskConsumer`) makes
 * that restore log a ClassNotFoundException, after which TaskService rewrites the entry without
 * the task. [dropUnloadable] makes the same removal before the restore, so the restore finds only
 * consumers it can load. An entry it cannot read is left alone for TaskService to handle.
 */
object PersistedTaskConsumers {
  const val PREFERENCES_NAME = "TaskManagerModule"
  private const val TAG = "TaskManagerMigration"

  /** Removes persisted tasks whose consumer class cannot be loaded; returns their names. */
  fun dropUnloadable(
    context: Context,
    isLoadable: (String) -> Boolean = { className -> loadable(context, className) },
  ): List<String> {
    val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    val editor = preferences.edit()
    val dropped = mutableListOf<String>()
    for ((appScopeKey, value) in preferences.all) {
      val config =
        (value as? String)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: continue
      val tasks = config.optJSONObject("tasks") ?: continue
      val stale =
        tasks.keys().asSequence().toList().filter { name ->
          val consumer = tasks.optJSONObject(name)?.optString("consumerClass").orEmpty()
          consumer.isNotEmpty() && !isLoadable(consumer)
        }
      if (stale.isEmpty()) continue
      for (name in stale) {
        tasks.remove(name)
        dropped += name
        Log.i(TAG, "Dropped persisted task '$name': the app no longer ships its consumer.")
      }
      // TaskService removes an app scope key that has no task left, so this does the same.
      if (tasks.length() == 0) editor.remove(appScopeKey)
      else editor.putString(appScopeKey, config.toString())
    }
    // Synchronous: a TaskService of this process may read the preferences right after.
    if (dropped.isNotEmpty()) editor.commit()
    return dropped
  }

  private fun loadable(context: Context, className: String): Boolean =
    try {
      Class.forName(className, false, context.classLoader)
      true
    } catch (_: ClassNotFoundException) {
      false
    } catch (_: LinkageError) {
      false
    }
}
