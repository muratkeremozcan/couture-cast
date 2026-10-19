// Load dependencies before plural rules. Hermes in Expo SDK 54 lacks these APIs.
import '@formatjs/intl-getcanonicallocales/polyfill.js'
import '@formatjs/intl-locale/polyfill.js'
// FormatJS recommends force loading to avoid the slow Android capability probe.
import '@formatjs/intl-pluralrules/polyfill-force.js'
import '@formatjs/intl-pluralrules/locale-data/en.js'
import '@formatjs/intl-pluralrules/locale-data/fr.js'
import '@formatjs/intl-pluralrules/locale-data/es.js'
import '@formatjs/intl-pluralrules/locale-data/tr.js'
import '@formatjs/intl-pluralrules/locale-data/de.js'
import '@formatjs/intl-pluralrules/locale-data/it.js'
import '@formatjs/intl-pluralrules/locale-data/pt.js'
import '@formatjs/intl-pluralrules/locale-data/pt-PT.js'
