// Story 3.3 Task 2 step 1 owner: render the atomic shared payload in Android widgets.
package com.anonymous.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

private const val WIDGET_PREFERENCES = "OutfitWidgetPrefs"
private const val WIDGET_PAYLOAD_KEY = "widgetPayload"
private const val STALE_INTERVAL_MS = 30 * 60 * 1000L

private data class WidgetData(
    val currentTemp: String,
    val feelsLikeTemp: String,
    val currentConditionIcon: String,
    val currentConditionText: String,
    val nowOutfitSummary: String,
    val nextHourTime: String,
    val nextHourTemp: String,
    val nextHourIcon: String,
    val nextHourPrecipitation: String,
    val nextOutfitSummary: String,
    val lastUpdated: String,
    val nowLabel: String,
    val nextHourLabel: String,
    val staleLabel: String,
    val unavailableLabel: String,
    val precipitationLabel: String,
) {
    fun isStale(now: Long = System.currentTimeMillis()): Boolean {
        val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
            isLenient = false
        }
        val updatedAt = runCatching { formatter.parse(lastUpdated)?.time }.getOrNull()
            ?: return false
        return now - updatedAt >= STALE_INTERVAL_MS
    }

    companion object {
        fun fromJson(payload: String): WidgetData {
            val json = JSONObject(payload)
            return WidgetData(
                currentTemp = json.getString("currentTemp"),
                feelsLikeTemp = json.getString("feelsLikeTemp"),
                currentConditionIcon = json.getString("currentConditionIcon"),
                currentConditionText = json.getString("currentConditionText"),
                nowOutfitSummary = json.getString("nowOutfitSummary"),
                nextHourTime = json.getString("nextHourTime"),
                nextHourTemp = json.getString("nextHourTemp"),
                nextHourIcon = json.getString("nextHourIcon"),
                nextHourPrecipitation = json.getString("nextHourPrecipitation"),
                nextOutfitSummary = json.getString("nextOutfitSummary"),
                lastUpdated = json.getString("lastUpdated"),
                nowLabel = json.getString("nowLabel"),
                nextHourLabel = json.getString("nextHourLabel"),
                staleLabel = json.getString("staleLabel"),
                unavailableLabel = json.getString("unavailableLabel"),
                precipitationLabel = json.getString("precipitationLabel"),
            )
        }

        fun empty(): WidgetData {
            val copy = NativeWidgetCopy.forLanguage(Locale.getDefault().language)
            return WidgetData(
                currentTemp = "--",
                feelsLikeTemp = "--",
                currentConditionIcon = "unknown",
                currentConditionText = copy.unavailable,
                nowOutfitSummary = copy.unavailable,
                nextHourTime = "",
                nextHourTemp = "--",
                nextHourIcon = "unknown",
                nextHourPrecipitation = "--",
                nextOutfitSummary = copy.unavailable,
                lastUpdated = "",
                nowLabel = copy.now,
                nextHourLabel = copy.nextHour,
                staleLabel = copy.stale,
                unavailableLabel = copy.unavailable,
                precipitationLabel = copy.precipitation,
            )
        }
    }
}

private data class NativeWidgetCopy(
    val now: String,
    val nextHour: String,
    val stale: String,
    val unavailable: String,
    val precipitation: String,
) {
    companion object {
        fun forLanguage(language: String): NativeWidgetCopy = when (language) {
            "de" -> NativeWidgetCopy(
                "JETZT",
                "NÄCHSTE STUNDE",
                "Veraltet",
                "App für Empfehlungen öffnen",
                "Niederschlag",
            )
            "es" -> NativeWidgetCopy(
                "AHORA",
                "PRÓXIMA HORA",
                "Desactualizado",
                "Abre la app para ver recomendaciones",
                "Precipitación",
            )
            "fr" -> NativeWidgetCopy(
                "MAINTENANT",
                "HEURE SUIVANTE",
                "Données anciennes",
                "Ouvrez l’application pour les recommandations",
                "Précipitations",
            )
            "it" -> NativeWidgetCopy(
                "ORA",
                "PROSSIMA ORA",
                "Non aggiornato",
                "Apri l’app per i consigli",
                "Precipitazioni",
            )
            "pt" -> NativeWidgetCopy(
                "AGORA",
                "PRÓXIMA HORA",
                "Desatualizado",
                "Abra o app para recomendações",
                "Precipitação",
            )
            "tr" -> NativeWidgetCopy(
                "ŞİMDİ",
                "SONRAKİ SAAT",
                "Güncel değil",
                "Öneriler için uygulamayı açın",
                "Yağış",
            )
            else -> NativeWidgetCopy(
                "NOW",
                "NEXT HOUR",
                "Stale",
                "Open app for recommendations",
                "Precipitation",
            )
        }
    }
}

abstract class OutfitWidgetProvider : AppWidgetProvider() {
    abstract val layoutId: Int
    abstract val widgetSize: String

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        val payload = context
            .getSharedPreferences(WIDGET_PREFERENCES, Context.MODE_PRIVATE)
            .getString(WIDGET_PAYLOAD_KEY, null)
        val data = payload
            ?.let { runCatching { WidgetData.fromJson(it) }.getOrNull() }
            ?: WidgetData.empty()

        appWidgetIds.forEach { appWidgetId ->
            val views = RemoteViews(context.packageName, layoutId)
            bindCommonViews(views, data)
            if (layoutId == R.layout.widget_medium) {
                bindMediumViews(views, data)
                views.setOnClickPendingIntent(
                    R.id.widget_now_section,
                    widgetPendingIntent(context, appWidgetId * 10, "now"),
                )
                views.setOnClickPendingIntent(
                    R.id.widget_next_section,
                    widgetPendingIntent(context, appWidgetId * 10 + 1, "next"),
                )
            } else {
                views.setOnClickPendingIntent(
                    R.id.widget_root,
                    widgetPendingIntent(context, appWidgetId * 10, "now"),
                )
            }
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }

    private fun bindCommonViews(views: RemoteViews, data: WidgetData) {
        views.setTextViewText(R.id.widget_temperature, data.feelsLikeTemp)
        views.setTextViewText(
            R.id.widget_condition,
            weatherGlyph(data.currentConditionIcon),
        )
        views.setContentDescription(R.id.widget_condition, data.currentConditionText)
        views.setTextViewText(R.id.widget_now_label, data.nowLabel)
        views.setTextViewText(R.id.widget_outfit_summary, data.nowOutfitSummary)
        views.setTextViewText(R.id.widget_stale, data.staleLabel)
        views.setViewVisibility(
            R.id.widget_stale,
            if (data.isStale()) View.VISIBLE else View.GONE,
        )
    }

    private fun bindMediumViews(views: RemoteViews, data: WidgetData) {
        views.setTextViewText(R.id.widget_next_icon, weatherGlyph(data.nextHourIcon))
        views.setTextViewText(R.id.widget_next_temp, data.nextHourTemp)
        views.setTextViewText(R.id.widget_next_time, data.nextHourTime)
        views.setTextViewText(
            R.id.widget_next_precipitation,
            "${data.precipitationLabel} ${data.nextHourPrecipitation}",
        )
        views.setTextViewText(R.id.widget_next_label, data.nextHourLabel)
        views.setTextViewText(R.id.widget_next_outfit_summary, data.nextOutfitSummary)
    }

    private fun widgetPendingIntent(
        context: Context,
        requestCode: Int,
        slot: String,
    ): PendingIntent {
        val uri = Uri.parse(
            "mobile://(tabs)?source=widget&size=$widgetSize&slot=$slot",
        )
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            `package` = context.packageName
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun weatherGlyph(condition: String): String = when (condition) {
        "clear" -> "☀"
        "partly_cloudy" -> "⛅"
        "cloudy" -> "☁"
        "fog" -> "≋"
        "drizzle" -> "🌦"
        "rain" -> "🌧"
        "sleet" -> "🌨"
        "snow" -> "❄"
        "thunderstorm" -> "⛈"
        "wind" -> "≋"
        else -> "?"
    }
}
