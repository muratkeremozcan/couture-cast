package expo.modules.sharecardnativeshare

import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider

/**
 * Module-owned provider with its own authority, so its paths never merge with another library's
 * FileProvider. `res/xml/share_card_native_share_paths.xml` exposes only `cache/share-cards/`.
 *
 * Receivers and the chooser preview read [OpenableColumns.DISPLAY_NAME] as the file's name; it is
 * always the public `couturecast-card.png`, the handoff file's own name. Every other column,
 * [OpenableColumns.SIZE] included, and every refusal stay FileProvider's.
 */
class ShareCardFileProvider : FileProvider() {
  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor = super.query(uri, projection, selection, selectionArgs, sortOrder).use(::withPublicName)

  companion object {
    private fun withPublicName(source: Cursor): Cursor {
      val columns = source.columnNames
      val result = MatrixCursor(columns, source.count)
      while (source.moveToNext()) {
        result.addRow(
          columns.indices.map { at ->
            when {
              columns[at] == OpenableColumns.DISPLAY_NAME -> ShareCardShareFiles.PUBLIC_NAME
              source.getType(at) == Cursor.FIELD_TYPE_INTEGER -> source.getLong(at)
              source.getType(at) == Cursor.FIELD_TYPE_NULL -> null
              else -> source.getString(at)
            }
          },
        )
      }
      return result
    }
  }
}
