package com.anonymous.mobile

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

private const val WIDGET_PREFERENCES = "OutfitWidgetPrefs"
private const val WIDGET_PAYLOAD_KEY = "widgetPayload"

class WidgetSharedModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    override fun getName() = "WidgetSharedModule"

    @ReactMethod
    fun setWidgetData(payload: String, promise: Promise) {
        val preferences = reactApplicationContext.getSharedPreferences(
            WIDGET_PREFERENCES,
            Context.MODE_PRIVATE,
        )
        val written = preferences.edit().putString(WIDGET_PAYLOAD_KEY, payload).commit()
        if (!written || preferences.getString(WIDGET_PAYLOAD_KEY, null) != payload) {
            promise.reject(
                "widget_storage_write_failed",
                "The widget payload could not be saved.",
            )
            return
        }

        refreshWidgets(OutfitWidgetProviderSmall::class.java)
        refreshWidgets(OutfitWidgetProviderMedium::class.java)
        promise.resolve(null)
    }

    private fun refreshWidgets(provider: Class<out OutfitWidgetProvider>) {
        val manager = AppWidgetManager.getInstance(reactApplicationContext)
        val component = ComponentName(reactApplicationContext, provider)
        val intent = Intent(reactApplicationContext, provider).apply {
            action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, manager.getAppWidgetIds(component))
        }
        reactApplicationContext.sendBroadcast(intent)
    }
}
