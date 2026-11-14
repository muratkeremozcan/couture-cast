package expo.modules.taskmanagermigration

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import expo.modules.interfaces.taskManager.TaskConsumer
import expo.modules.interfaces.taskManager.TaskInterface
import expo.modules.interfaces.taskManager.TaskManagerUtilsInterface
import expo.modules.interfaces.taskManager.TaskServiceInterface
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

/** Stands in for a consumer the app still ships, such as expo-background-task's. */
class ShippedTestConsumer(context: Context, utils: TaskManagerUtilsInterface) :
  TaskConsumer(context, utils) {
  override fun taskType() = "test"

  override fun didRegister(task: TaskInterface) = Unit

  override fun didUnregister() = Unit
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PersistedTaskConsumersTest {
  private val appScopeKey = "com.couturecast.story68"
  private val retiredConsumer = "expo.modules.backgroundfetch.BackgroundFetchTaskConsumer"

  /** The exact entry an SDK 54 (a01e0307) Release persisted after sign-in, read from a device. */
  private val sdk54Entry =
    """{"appUrl":"com.couturecast.story68","tasks":{"RITUAL_BACKGROUND_FETCH_TASK":""" +
      """{"name":"RITUAL_BACKGROUND_FETCH_TASK","options":{"minimumInterval":900,""" +
      """"stopOnTerminate":false,"startOnBoot":true},"consumerClass":"$retiredConsumer",""" +
      """"consumerVersion":0}}}"""

  private val context: Application = ApplicationProvider.getApplicationContext()
  private val preferences
    get() =
      context.getSharedPreferences(PersistedTaskConsumers.PREFERENCES_NAME, Context.MODE_PRIVATE)

  @Before
  fun reset() {
    preferences.edit().clear().commit()
    ShadowLog.clear()
  }

  @Test
  fun `the upgrade restore after the cleanup logs no ClassNotFoundException and keeps live tasks`() {
    val entry = JSONObject(sdk54Entry)
    entry
      .getJSONObject("tasks")
      .put(
        "RITUAL_BACKGROUND_TASK",
        JSONObject()
          .put("name", "RITUAL_BACKGROUND_TASK")
          .put("options", JSONObject().put("minimumInterval", 15))
          .put("consumerClass", ShippedTestConsumer::class.java.name)
          .put("consumerVersion", 0),
      )
    preferences.edit().putString(appScopeKey, entry.toString()).commit()

    // What Application.onCreate runs before any receiver, job or activity of the process.
    TaskManagerMigrationLifecycleListener().onCreate(context)
    val service = newTaskService()

    val restoreErrors =
      ShadowLog.getLogsForTag("TaskService").filter {
        it.throwable is ClassNotFoundException || it.msg?.contains(retiredConsumer) == true
      }
    assertTrue("restore errors: ${restoreErrors.map { it.msg }}", restoreErrors.isEmpty())
    assertFalse(service.hasRegisteredTask("RITUAL_BACKGROUND_FETCH_TASK", appScopeKey))
    assertTrue(service.hasRegisteredTask("RITUAL_BACKGROUND_TASK", appScopeKey))
    val persisted = JSONObject(preferences.getString(appScopeKey, null)!!).getJSONObject("tasks")
    assertFalse(persisted.has("RITUAL_BACKGROUND_FETCH_TASK"))
    assertTrue(persisted.has("RITUAL_BACKGROUND_TASK"))
  }

  @Test
  fun `an app scope left without tasks is removed, as TaskService removes it`() {
    preferences.edit().putString(appScopeKey, sdk54Entry).commit()

    val dropped = PersistedTaskConsumers.dropUnloadable(context)

    assertEquals(listOf("RITUAL_BACKGROUND_FETCH_TASK"), dropped)
    assertNull(preferences.getString(appScopeKey, null))
  }

  @Test
  fun `entries it cannot read and loadable consumers are left untouched`() {
    val live =
      """{"appUrl":"x","tasks":{"KEEP":{"consumerClass":"${ShippedTestConsumer::class.java.name}"}}}"""
    preferences
      .edit()
      .putString("unreadable", "not json")
      .putString("live", live)
      .putString("noTasks", """{"appUrl":"x"}""")
      .commit()

    assertEquals(emptyList<String>(), PersistedTaskConsumers.dropUnloadable(context))
    assertEquals("not json", preferences.getString("unreadable", null))
    assertEquals(live, preferences.getString("live", null))
    assertEquals("""{"appUrl":"x"}""", preferences.getString("noTasks", null))
  }

  /** expo-task-manager renames its Java package in SDK 58; the restore is the same code. */
  private fun newTaskService(): TaskServiceInterface {
    val type =
      listOf("expo.modules.taskManager.TaskService", "expo.modules.taskmanager.TaskService")
        .firstNotNullOf { runCatching { Class.forName(it) }.getOrNull() }
    return type.getConstructor(Context::class.java).newInstance(context) as TaskServiceInterface
  }
}
