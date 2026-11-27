// Story 6.17 D11: Google sign-in and finish-step copy for the ten supported locales, shared
// by web and mobile so both clients say the same thing for the same outcome.
import { SUPPORTED_SIGNIN_LOCALES, type SupportedSigninLocale } from './locales'
import type { BirthdateAgeGateEvaluation } from '../age'

export type FederatedSignInStrings = {
  continueWithGoogle: string
  divider: string
  opening: string
  cancelled: string
  unavailable: string
  refused: string
  finishing: string
  finishTitle: string
  finishIntro: string
  googleAccount: string
  birthdate: string
  birthdateHint: string
  create: string
  creating: string
  cancel: string
  cancelling: string
  createdGuardianPending: string
  awaitingGuardian: string
  /** The guardian step's heading: the account exists, it waits on a guardian. */
  guardianStepTitle: string
  /** The guardian step's button, which ends the session. */
  guardianStepLeave: string
  continue: string
  underage: string
  invalidBirthdate: string
  guardianRequired: string
  guardianMinor: string
  createUnavailable: string
  alreadyRegistered: string
  noSession: string
  guardianTitle: string
  guardianIntro: string
  guardianEmail: string
  consentLevel: string
  readOnly: string
  fullAccess: string
  readOnlyConsent: string
  fullAccessConsent: string
  sendInvite: string
  sendingInvite: string
  inviteSent: string
  invalidGuardianEmail: string
  inviteFailed: string
  /** The email signup page: eyebrow, heading and intro above the form. */
  signupEyebrow: string
  signupHeading: string
  signupIntro: string
  backHome: string
  email: string
  /** After an email signup: the account exists, sign in to use it. */
  signupCreated: string
}

export const FEDERATED_SIGNIN_STRINGS: Readonly<
  Record<SupportedSigninLocale, FederatedSignInStrings>
> = {
  'en-US': {
    continueWithGoogle: 'Continue with Google',
    divider: 'or',
    opening: 'Opening Google…',
    cancelled: 'Google sign-in was cancelled.',
    unavailable:
      'Google sign-in is temporarily unavailable. Try again, or sign in with an email code.',
    refused:
      'This Google account cannot sign in to CoutureCast. Sign in with an email code instead.',
    finishing: 'Finishing sign-in…',
    finishTitle: 'Finish setup',
    finishIntro: 'You signed in with Google. Add your birthdate to make your account.',
    googleAccount: 'Google account',
    birthdate: 'Birthdate',
    birthdateHint: 'We use your birthdate only to check your age.',
    create: 'Create account',
    creating: 'Creating account…',
    cancel: 'Cancel',
    cancelling: 'Cancelling…',
    createdGuardianPending:
      'Your account is set up. Your guardian must approve it before you can add photos. Send the invite, then sign in after they approve.',
    awaitingGuardian:
      'Your guardian still needs to approve your account. Send the invite, then sign in after they approve.',
    guardianStepTitle: 'Waiting for your guardian',
    guardianStepLeave: 'Sign out',
    continue: 'Continue',
    underage: 'You must be 13 or older',
    invalidBirthdate: 'Enter your birthdate as YYYY-MM-DD',
    guardianRequired: 'You need your guardian’s approval.',
    guardianMinor: 'Guardian accounts need an adult birthdate.',
    createUnavailable:
      'Your account could not be created right now. Try again in a moment.',
    alreadyRegistered:
      'This Google address already has a CoutureCast account. Signing you in…',
    noSession: 'Your Google sign-in has ended. Start again from Sign in.',
    guardianTitle: 'Invite a guardian',
    guardianIntro: 'Ask your guardian to approve your account.',
    guardianEmail: 'Guardian email',
    consentLevel: 'Consent level',
    readOnly: 'Read only',
    fullAccess: 'Full access',
    readOnlyConsent: 'Read only consent',
    fullAccessConsent: 'Full access consent',
    sendInvite: 'Send guardian invite',
    sendingInvite: 'Sending invite…',
    inviteSent: 'We sent an invite to {email}. Share the link if they miss the email.',
    invalidGuardianEmail: 'Enter a valid guardian email address.',
    inviteFailed: 'The guardian invitation could not be sent. Try again.',
    signupEyebrow: 'Age check',
    signupHeading: 'Enter your birthdate',
    signupIntro: 'You must be 13 or older to make an account.',
    backHome: 'Back home',
    email: 'Email',
    signupCreated: 'Account created. Sign in with your email to continue.',
  },
  'en-CA': {
    continueWithGoogle: 'Continue with Google',
    divider: 'or',
    opening: 'Opening Google…',
    cancelled: 'Google sign-in was cancelled.',
    unavailable:
      'Google sign-in is temporarily unavailable. Try again, or sign in with an email code.',
    refused:
      'This Google account cannot sign in to CoutureCast. Sign in with an email code instead.',
    finishing: 'Finishing sign-in…',
    finishTitle: 'Finish setup',
    finishIntro: 'You signed in with Google. Add your birthdate to make your account.',
    googleAccount: 'Google account',
    birthdate: 'Birthdate',
    birthdateHint: 'We use your birthdate only to check your age.',
    create: 'Create account',
    creating: 'Creating account…',
    cancel: 'Cancel',
    cancelling: 'Cancelling…',
    createdGuardianPending:
      'Your account is set up. Your guardian must approve it before you can add photos. Send the invite, then sign in after they approve.',
    awaitingGuardian:
      'Your guardian still needs to approve your account. Send the invite, then sign in after they approve.',
    guardianStepTitle: 'Waiting for your guardian',
    guardianStepLeave: 'Sign out',
    continue: 'Continue',
    underage: 'You must be 13 or older',
    invalidBirthdate: 'Enter your birthdate as YYYY-MM-DD',
    guardianRequired: 'You need your guardian’s approval.',
    guardianMinor: 'Guardian accounts need an adult birthdate.',
    createUnavailable:
      'Your account could not be created right now. Try again in a moment.',
    alreadyRegistered:
      'This Google address already has a CoutureCast account. Signing you in…',
    noSession: 'Your Google sign-in has ended. Start again from Sign in.',
    guardianTitle: 'Invite a guardian',
    guardianIntro: 'Ask your guardian to approve your account.',
    guardianEmail: 'Guardian email',
    consentLevel: 'Consent level',
    readOnly: 'Read only',
    fullAccess: 'Full access',
    readOnlyConsent: 'Read only consent',
    fullAccessConsent: 'Full access consent',
    sendInvite: 'Send guardian invite',
    sendingInvite: 'Sending invite…',
    inviteSent: 'We sent an invite to {email}. Share the link if they miss the email.',
    invalidGuardianEmail: 'Enter a valid guardian email address.',
    inviteFailed: 'The guardian invitation could not be sent. Try again.',
    signupEyebrow: 'Age check',
    signupHeading: 'Enter your birthdate',
    signupIntro: 'You must be 13 or older to make an account.',
    backHome: 'Back home',
    email: 'Email',
    signupCreated: 'Account created. Sign in with your email to continue.',
  },
  'es-419': {
    continueWithGoogle: 'Continuar con Google',
    divider: 'o',
    opening: 'Abriendo Google…',
    cancelled: 'Se canceló el inicio de sesión con Google.',
    unavailable:
      'El inicio de sesión con Google no está disponible por ahora. Vuelve a intentarlo o inicia sesión con un código por correo.',
    refused:
      'Esta cuenta de Google no puede iniciar sesión en CoutureCast. Inicia sesión con un código por correo.',
    finishing: 'Terminando el inicio de sesión…',
    finishTitle: 'Termina el registro',
    finishIntro:
      'Ya iniciaste sesión con Google. Escribe tu fecha de nacimiento para crear tu cuenta.',
    googleAccount: 'Cuenta de Google',
    birthdate: 'Fecha de nacimiento',
    birthdateHint: 'Solo usamos tu fecha de nacimiento para comprobar tu edad.',
    create: 'Crear cuenta',
    creating: 'Creando cuenta…',
    cancel: 'Cancelar',
    cancelling: 'Cancelando…',
    createdGuardianPending:
      'Tu cuenta está lista. Tu tutor debe aprobarla antes de que agregues fotos. Envía la invitación y vuelve a iniciar sesión cuando la apruebe.',
    awaitingGuardian:
      'Tu tutor aún debe aprobar tu cuenta. Envía la invitación y vuelve a iniciar sesión cuando la apruebe.',
    guardianStepTitle: 'Esperando a tu tutor',
    guardianStepLeave: 'Cerrar sesión',
    continue: 'Continuar',
    underage: 'Debes tener 13 años o más',
    invalidBirthdate: 'Escribe tu fecha de nacimiento en formato YYYY-MM-DD',
    guardianRequired: 'Necesitas la aprobación de tu tutor.',
    guardianMinor: 'Las cuentas de tutor necesitan una fecha de nacimiento de un adulto.',
    createUnavailable:
      'No pudimos crear tu cuenta en este momento. Vuelve a intentarlo en un momento.',
    alreadyRegistered:
      'Esta dirección de Google ya tiene una cuenta de CoutureCast. Iniciando sesión…',
    noSession:
      'Tu inicio de sesión con Google terminó. Vuelve a empezar desde Iniciar sesión.',
    guardianTitle: 'Invita a tu tutor',
    guardianIntro: 'Pide a tu tutor que apruebe tu cuenta.',
    guardianEmail: 'Correo del tutor',
    consentLevel: 'Nivel de consentimiento',
    readOnly: 'Solo lectura',
    fullAccess: 'Acceso completo',
    readOnlyConsent: 'Consentimiento de solo lectura',
    fullAccessConsent: 'Consentimiento de acceso completo',
    sendInvite: 'Enviar invitación al tutor',
    sendingInvite: 'Enviando invitación…',
    inviteSent:
      'Enviamos una invitación a {email}. Comparte el enlace si no ven el correo.',
    invalidGuardianEmail: 'Escribe un correo válido para el tutor.',
    inviteFailed: 'No se pudo enviar la invitación al tutor. Vuelve a intentarlo.',
    signupEyebrow: 'Control de edad',
    signupHeading: 'Escribe tu fecha de nacimiento',
    signupIntro: 'Debes tener 13 años o más para crear una cuenta.',
    backHome: 'Volver al inicio',
    email: 'Correo electrónico',
    signupCreated:
      'Cuenta creada. Inicia sesión con tu correo electrónico para continuar.',
  },
  'fr-CA': {
    continueWithGoogle: 'Continuer avec Google',
    divider: 'ou',
    opening: 'Ouverture de Google…',
    cancelled: 'La connexion avec Google a été annulée.',
    unavailable:
      'La connexion avec Google est temporairement indisponible. Réessayez ou connectez-vous avec un code par courriel.',
    refused:
      'Ce compte Google ne peut pas se connecter à CoutureCast. Connectez-vous plutôt avec un code par courriel.',
    finishing: 'Finalisation de la connexion…',
    finishTitle: 'Termine ton inscription',
    finishIntro:
      'Tu es connecté avec Google. Entre ta date de naissance pour créer ton compte.',
    googleAccount: 'Compte Google',
    birthdate: 'Date de naissance',
    birthdateHint: 'On utilise ta date de naissance seulement pour vérifier ton âge.',
    create: 'Créer le compte',
    creating: 'Création du compte…',
    cancel: 'Annuler',
    cancelling: 'Annulation…',
    createdGuardianPending:
      'Ton compte est créé. Ton parent ou tuteur doit l’approuver avant que tu puisses ajouter des photos. Envoie l’invitation et reconnecte-toi après son accord.',
    awaitingGuardian:
      'Ton parent ou tuteur doit encore approuver ton compte. Envoie l’invitation et reconnecte-toi après son accord.',
    guardianStepTitle: 'En attente de votre parent ou tuteur',
    guardianStepLeave: 'Se déconnecter',
    continue: 'Continuer',
    underage: 'Tu dois avoir 13 ans ou plus',
    invalidBirthdate: 'Entre ta date de naissance au format YYYY-MM-DD',
    guardianRequired: 'Il te faut l’accord de ton parent ou tuteur.',
    guardianMinor: "Les comptes de tuteur exigent une date de naissance d'adulte.",
    createUnavailable:
      "Votre compte n'a pas pu être créé pour le moment. Réessayez dans un instant.",
    alreadyRegistered:
      'Cette adresse Google a déjà un compte CoutureCast. Connexion en cours…',
    noSession:
      'Votre connexion avec Google a pris fin. Recommencez à partir de Se connecter.',
    guardianTitle: 'Invite ton parent ou tuteur',
    guardianIntro: 'Demande à ton parent ou tuteur d’approuver ton compte.',
    guardianEmail: 'Courriel du tuteur',
    consentLevel: 'Niveau de consentement',
    readOnly: 'Lecture seule',
    fullAccess: 'Accès complet',
    readOnlyConsent: 'Consentement en lecture seule',
    fullAccessConsent: "Consentement d'accès complet",
    sendInvite: "Envoyer l'invitation au tuteur",
    sendingInvite: "Envoi de l'invitation…",
    inviteSent:
      'On a envoyé une invitation à {email}. Partage le lien si la personne ne voit pas le courriel.',
    invalidGuardianEmail: 'Entrez une adresse courriel valide pour le tuteur.',
    inviteFailed: "L'invitation au tuteur n'a pas pu être envoyée. Réessayez.",
    signupEyebrow: 'Vérification de l’âge',
    signupHeading: 'Entre ta date de naissance',
    signupIntro: 'Tu dois avoir 13 ans ou plus pour créer un compte.',
    backHome: "Retour à l'accueil",
    email: 'Adresse courriel',
    signupCreated:
      'Compte créé. Connectez-vous avec votre adresse courriel pour continuer.',
  },
  'fr-FR': {
    continueWithGoogle: 'Continuer avec Google',
    divider: 'ou',
    opening: 'Ouverture de Google…',
    cancelled: 'La connexion avec Google a été annulée.',
    unavailable:
      'La connexion avec Google est temporairement indisponible. Réessayez ou connectez-vous avec un code reçu par e-mail.',
    refused:
      'Ce compte Google ne peut pas se connecter à CoutureCast. Connectez-vous plutôt avec un code reçu par e-mail.',
    finishing: 'Finalisation de la connexion…',
    finishTitle: 'Termine ton inscription',
    finishIntro:
      'Tu es connecté avec Google. Saisis ta date de naissance pour créer ton compte.',
    googleAccount: 'Compte Google',
    birthdate: 'Date de naissance',
    birthdateHint: 'On utilise ta date de naissance seulement pour vérifier ton âge.',
    create: 'Créer le compte',
    creating: 'Création du compte…',
    cancel: 'Annuler',
    cancelling: 'Annulation…',
    createdGuardianPending:
      'Ton compte est créé. Ton parent ou tuteur doit l’approuver avant que tu puisses ajouter des photos. Envoie l’invitation et reconnecte-toi après son accord.',
    awaitingGuardian:
      'Ton parent ou tuteur doit encore approuver ton compte. Envoie l’invitation et reconnecte-toi après son accord.',
    guardianStepTitle: 'En attente de votre parent ou tuteur',
    guardianStepLeave: 'Se déconnecter',
    continue: 'Continuer',
    underage: 'Tu dois avoir 13 ans ou plus',
    invalidBirthdate: 'Saisis ta date de naissance au format YYYY-MM-DD',
    guardianRequired: 'Il te faut l’accord de ton parent ou tuteur.',
    guardianMinor: "Les comptes de tuteur exigent une date de naissance d'adulte.",
    createUnavailable:
      "Votre compte n'a pas pu être créé pour le moment. Réessayez dans un instant.",
    alreadyRegistered:
      'Cette adresse Google a déjà un compte CoutureCast. Connexion en cours…',
    noSession: 'Votre connexion avec Google a pris fin. Recommencez depuis Se connecter.',
    guardianTitle: 'Invite ton parent ou tuteur',
    guardianIntro: 'Demande à ton parent ou tuteur d’approuver ton compte.',
    guardianEmail: 'E-mail du tuteur',
    consentLevel: 'Niveau de consentement',
    readOnly: 'Lecture seule',
    fullAccess: 'Accès complet',
    readOnlyConsent: 'Consentement en lecture seule',
    fullAccessConsent: "Consentement d'accès complet",
    sendInvite: "Envoyer l'invitation au tuteur",
    sendingInvite: "Envoi de l'invitation…",
    inviteSent:
      'On a envoyé une invitation à {email}. Partage le lien si la personne ne voit pas l’e-mail.',
    invalidGuardianEmail: 'Saisissez une adresse e-mail valide pour le tuteur.',
    inviteFailed: "L'invitation au tuteur n'a pas pu être envoyée. Réessayez.",
    signupEyebrow: 'Vérification de l’âge',
    signupHeading: 'Saisis ta date de naissance',
    signupIntro: 'Tu dois avoir 13 ans ou plus pour créer un compte.',
    backHome: "Retour à l'accueil",
    email: 'Adresse e-mail',
    signupCreated:
      'Compte créé. Connectez-vous avec votre adresse e-mail pour continuer.',
  },
  'tr-TR': {
    continueWithGoogle: 'Google ile devam et',
    divider: 'veya',
    opening: 'Google açılıyor…',
    cancelled: 'Google ile giriş iptal edildi.',
    unavailable:
      'Google ile giriş şu anda kullanılamıyor. Tekrar deneyin veya e-posta koduyla giriş yapın.',
    refused:
      "Bu Google hesabı CoutureCast'e giriş yapamaz. Bunun yerine e-posta koduyla giriş yapın.",
    finishing: 'Giriş tamamlanıyor…',
    finishTitle: 'Kaydını tamamla',
    finishIntro: 'Google ile giriş yaptın. Hesap açmak için doğum tarihini gir.',
    googleAccount: 'Google hesabı',
    birthdate: 'Doğum tarihi',
    birthdateHint: 'Doğum tarihini sadece yaşını kontrol etmek için kullanırız.',
    create: 'Hesap oluştur',
    creating: 'Hesap oluşturuluyor…',
    cancel: 'İptal',
    cancelling: 'İptal ediliyor…',
    createdGuardianPending:
      'Hesabın açıldı. Fotoğraf eklemeden önce velin hesabı onaylamalı. Daveti gönder, onaydan sonra giriş yap.',
    awaitingGuardian:
      'Velin hesabını henüz onaylamadı. Daveti gönder, onaydan sonra giriş yap.',
    guardianStepTitle: 'Velinizin onayı bekleniyor',
    guardianStepLeave: 'Çıkış yap',
    continue: 'Devam',
    underage: 'En az 13 yaşında olmalısın',
    invalidBirthdate: 'Doğum tarihini YYYY-MM-DD biçiminde gir',
    guardianRequired: 'Velinin onayı gerekiyor.',
    guardianMinor: 'Veli hesapları için yetişkin doğum tarihi gerekir.',
    createUnavailable: 'Hesabınız şu anda oluşturulamadı. Biraz sonra tekrar deneyin.',
    alreadyRegistered:
      'Bu Google adresinin zaten bir CoutureCast hesabı var. Giriş yapılıyor…',
    noSession: 'Google ile girişiniz sona erdi. Giriş yap sayfasından yeniden başlayın.',
    guardianTitle: 'Velini davet et',
    guardianIntro: 'Velinden hesabını onaylamasını iste.',
    guardianEmail: 'Veli e-postası',
    consentLevel: 'Onay düzeyi',
    readOnly: 'Salt okunur',
    fullAccess: 'Tam erişim',
    readOnlyConsent: 'Salt okunur onay',
    fullAccessConsent: 'Tam erişim onayı',
    sendInvite: 'Veli daveti gönder',
    sendingInvite: 'Davet gönderiliyor…',
    inviteSent: '{email} adresine davet gönderdik. E-postayı görmezse bağlantıyı paylaş.',
    invalidGuardianEmail: 'Geçerli bir veli e-posta adresi girin.',
    inviteFailed: 'Veli daveti gönderilemedi. Tekrar deneyin.',
    signupEyebrow: 'Yaş kontrolü',
    signupHeading: 'Doğum tarihini gir',
    signupIntro: 'Hesap açmak için en az 13 yaşında olmalısın.',
    backHome: 'Ana sayfaya dön',
    email: 'E-posta adresi',
    signupCreated: 'Hesap oluşturuldu. Devam etmek için e-posta adresinizle giriş yapın.',
  },
  'de-DE': {
    continueWithGoogle: 'Weiter mit Google',
    divider: 'oder',
    opening: 'Google wird geöffnet…',
    cancelled: 'Die Anmeldung mit Google wurde abgebrochen.',
    unavailable:
      'Die Anmeldung mit Google ist vorübergehend nicht verfügbar. Versuche es erneut oder melde dich mit einem E-Mail-Code an.',
    refused:
      'Mit diesem Google-Konto ist keine Anmeldung bei CoutureCast möglich. Melde dich stattdessen mit einem E-Mail-Code an.',
    finishing: 'Anmeldung wird abgeschlossen…',
    finishTitle: 'Einrichtung abschließen',
    finishIntro:
      'Du bist mit Google angemeldet. Gib dein Geburtsdatum ein, um dein Konto zu erstellen.',
    googleAccount: 'Google-Konto',
    birthdate: 'Geburtsdatum',
    birthdateHint: 'Wir nutzen dein Geburtsdatum nur, um dein Alter zu prüfen.',
    create: 'Konto erstellen',
    creating: 'Konto wird erstellt…',
    cancel: 'Abbrechen',
    cancelling: 'Wird abgebrochen…',
    createdGuardianPending:
      'Dein Konto ist erstellt. Ein Elternteil oder Vormund muss zustimmen, bevor du Fotos hinzufügen kannst. Sende die Einladung und melde dich nach der Zustimmung wieder an.',
    awaitingGuardian:
      'Ein Elternteil oder Vormund muss deinem Konto noch zustimmen. Sende die Einladung und melde dich nach der Zustimmung wieder an.',
    guardianStepTitle: 'Warten auf deine erziehungsberechtigte Person',
    guardianStepLeave: 'Abmelden',
    continue: 'Weiter',
    underage: 'Du musst mindestens 13 sein',
    invalidBirthdate: 'Gib dein Geburtsdatum als YYYY-MM-DD ein',
    guardianRequired: 'Du brauchst die Zustimmung eines Elternteils oder Vormunds.',
    guardianMinor:
      'Konten von Erziehungsberechtigten brauchen das Geburtsdatum einer erwachsenen Person.',
    createUnavailable:
      'Dein Konto konnte gerade nicht erstellt werden. Versuche es gleich noch einmal.',
    alreadyRegistered:
      'Für diese Google-Adresse gibt es bereits ein CoutureCast-Konto. Du wirst angemeldet…',
    noSession: 'Deine Anmeldung mit Google ist beendet. Starte erneut über Anmelden.',
    guardianTitle: 'Elternteil oder Vormund einladen',
    guardianIntro: 'Bitte einen Elternteil oder Vormund, deinem Konto zuzustimmen.',
    guardianEmail: 'E-Mail der erziehungsberechtigten Person',
    consentLevel: 'Einwilligungsstufe',
    readOnly: 'Nur lesen',
    fullAccess: 'Vollzugriff',
    readOnlyConsent: 'Einwilligung nur zum Lesen',
    fullAccessConsent: 'Einwilligung für Vollzugriff',
    sendInvite: 'Einladung senden',
    sendingInvite: 'Einladung wird gesendet…',
    inviteSent:
      'Wir haben eine Einladung an {email} gesendet. Teile den Link, falls die E-Mail übersehen wird.',
    invalidGuardianEmail:
      'Gib eine gültige E-Mail-Adresse der erziehungsberechtigten Person ein.',
    inviteFailed: 'Die Einladung konnte nicht gesendet werden. Versuche es erneut.',
    signupEyebrow: 'Altersprüfung',
    signupHeading: 'Gib dein Geburtsdatum ein',
    signupIntro: 'Du musst mindestens 13 sein, um ein Konto zu erstellen.',
    backHome: 'Zur Startseite',
    email: 'E-Mail-Adresse',
    signupCreated:
      'Konto erstellt. Melde dich mit deiner E-Mail-Adresse an, um fortzufahren.',
  },
  'it-IT': {
    continueWithGoogle: 'Continua con Google',
    divider: 'oppure',
    opening: 'Apertura di Google…',
    cancelled: "L'accesso con Google è stato annullato.",
    unavailable:
      "L'accesso con Google non è al momento disponibile. Riprova oppure accedi con un codice via email.",
    refused:
      'Questo account Google non può accedere a CoutureCast. Accedi invece con un codice via email.',
    finishing: "Completamento dell'accesso…",
    finishTitle: 'Completa la registrazione',
    finishIntro:
      'Hai effettuato l’accesso con Google. Inserisci la data di nascita per creare il tuo account.',
    googleAccount: 'Account Google',
    birthdate: 'Data di nascita',
    birthdateHint: 'Usiamo la tua data di nascita solo per controllare la tua età.',
    create: 'Crea account',
    creating: "Creazione dell'account…",
    cancel: 'Annulla',
    cancelling: 'Annullamento…',
    createdGuardianPending:
      'Il tuo account è pronto. Un genitore o tutore deve approvarlo prima che tu possa aggiungere foto. Invia l’invito e accedi dopo il suo consenso.',
    awaitingGuardian:
      'Il tuo genitore o tutore deve ancora approvare l’account. Invia l’invito e accedi dopo il suo consenso.',
    guardianStepTitle: 'In attesa del tuo genitore o tutore',
    guardianStepLeave: 'Esci',
    continue: 'Continua',
    underage: 'Devi avere almeno 13 anni',
    invalidBirthdate: 'Inserisci la data di nascita in formato YYYY-MM-DD',
    guardianRequired: 'Ti serve il consenso di un genitore o tutore.',
    guardianMinor: 'Gli account dei tutori richiedono la data di nascita di un adulto.',
    createUnavailable:
      'Non è stato possibile creare il tuo account in questo momento. Riprova tra poco.',
    alreadyRegistered:
      'Questo indirizzo Google ha già un account CoutureCast. Accesso in corso…',
    noSession: "L'accesso con Google è terminato. Ricomincia da Accedi.",
    guardianTitle: 'Invita un genitore o tutore',
    guardianIntro: 'Chiedi a un genitore o tutore di approvare il tuo account.',
    guardianEmail: 'Email del tutore',
    consentLevel: 'Livello di consenso',
    readOnly: 'Sola lettura',
    fullAccess: 'Accesso completo',
    readOnlyConsent: 'Consenso in sola lettura',
    fullAccessConsent: 'Consenso ad accesso completo',
    sendInvite: 'Invia invito al tutore',
    sendingInvite: "Invio dell'invito…",
    inviteSent:
      'Abbiamo inviato un invito a {email}. Condividi il link se l’e-mail sfugge.',
    invalidGuardianEmail: 'Inserisci un indirizzo email valido per il tutore.',
    inviteFailed: "Non è stato possibile inviare l'invito al tutore. Riprova.",
    signupEyebrow: 'Controllo dell’età',
    signupHeading: 'Inserisci la tua data di nascita',
    signupIntro: 'Devi avere almeno 13 anni per creare un account.',
    backHome: 'Torna alla home',
    email: 'Indirizzo email',
    signupCreated: 'Account creato. Accedi con il tuo indirizzo email per continuare.',
  },
  'pt-BR': {
    continueWithGoogle: 'Continuar com o Google',
    divider: 'ou',
    opening: 'Abrindo o Google…',
    cancelled: 'O login com o Google foi cancelado.',
    unavailable:
      'O login com o Google está indisponível no momento. Tente de novo ou entre com um código por e-mail.',
    refused:
      'Esta conta do Google não pode entrar no CoutureCast. Entre com um código por e-mail.',
    finishing: 'Concluindo o login…',
    finishTitle: 'Termine o cadastro',
    finishIntro:
      'Você entrou com o Google. Informe sua data de nascimento para criar sua conta.',
    googleAccount: 'Conta do Google',
    birthdate: 'Data de nascimento',
    birthdateHint: 'Usamos sua data de nascimento só para verificar sua idade.',
    create: 'Criar conta',
    creating: 'Criando conta…',
    cancel: 'Cancelar',
    cancelling: 'Cancelando…',
    createdGuardianPending:
      'Sua conta foi criada. Seu responsável precisa aprová-la antes de você adicionar fotos. Mande o convite e entre depois da aprovação.',
    awaitingGuardian:
      'Seu responsável ainda precisa aprovar a conta. Mande o convite e entre depois da aprovação.',
    guardianStepTitle: 'Aguardando seu responsável',
    guardianStepLeave: 'Sair',
    continue: 'Continuar',
    underage: 'Você precisa ter 13 anos ou mais',
    invalidBirthdate: 'Digite sua data de nascimento no formato YYYY-MM-DD',
    guardianRequired: 'Você precisa da autorização do seu responsável.',
    guardianMinor: 'Contas de responsável precisam da data de nascimento de um adulto.',
    createUnavailable:
      'Não foi possível criar sua conta agora. Tente de novo em instantes.',
    alreadyRegistered:
      'Este endereço do Google já tem uma conta do CoutureCast. Entrando…',
    noSession: 'Seu login com o Google terminou. Comece de novo em Entrar.',
    guardianTitle: 'Convide seu responsável',
    guardianIntro: 'Peça ao seu responsável para aprovar sua conta.',
    guardianEmail: 'E-mail do responsável',
    consentLevel: 'Nível de consentimento',
    readOnly: 'Somente leitura',
    fullAccess: 'Acesso total',
    readOnlyConsent: 'Consentimento somente leitura',
    fullAccessConsent: 'Consentimento de acesso total',
    sendInvite: 'Enviar convite ao responsável',
    sendingInvite: 'Enviando convite…',
    inviteSent:
      'Mandamos um convite para {email}. Compartilhe o link se a pessoa não vir o e-mail.',
    invalidGuardianEmail: 'Digite um e-mail válido para o responsável.',
    inviteFailed: 'Não foi possível enviar o convite ao responsável. Tente de novo.',
    signupEyebrow: 'Verificação de idade',
    signupHeading: 'Informe sua data de nascimento',
    signupIntro: 'Você precisa ter 13 anos ou mais para criar uma conta.',
    backHome: 'Voltar ao início',
    email: 'Endereço de e-mail',
    signupCreated: 'Conta criada. Entre com seu e-mail para continuar.',
  },
  'pt-PT': {
    continueWithGoogle: 'Continuar com o Google',
    divider: 'ou',
    opening: 'A abrir o Google…',
    cancelled: 'O início de sessão com o Google foi cancelado.',
    unavailable:
      'O início de sessão com o Google está temporariamente indisponível. Tente novamente ou inicie sessão com um código por email.',
    refused:
      'Esta conta Google não pode iniciar sessão no CoutureCast. Inicie sessão com um código por email.',
    finishing: 'A concluir o início de sessão…',
    finishTitle: 'Termina o registo',
    finishIntro:
      'Entraste com o Google. Indica a tua data de nascimento para criares a tua conta.',
    googleAccount: 'Conta Google',
    birthdate: 'Data de nascimento',
    birthdateHint: 'Só usamos a tua data de nascimento para confirmar a tua idade.',
    create: 'Criar conta',
    creating: 'A criar conta…',
    cancel: 'Cancelar',
    cancelling: 'A cancelar…',
    createdGuardianPending:
      'A tua conta está criada. O teu encarregado de educação tem de a aprovar antes de poderes adicionar fotografias. Envia o convite e entra após a aprovação.',
    awaitingGuardian:
      'O teu encarregado de educação ainda tem de aprovar a conta. Envia o convite e entra após a aprovação.',
    guardianStepTitle: 'A aguardar o seu encarregado de educação',
    guardianStepLeave: 'Terminar sessão',
    continue: 'Continuar',
    underage: 'Tens de ter 13 anos ou mais',
    invalidBirthdate: 'Indica a tua data de nascimento no formato YYYY-MM-DD',
    guardianRequired: 'Precisas da autorização do teu encarregado de educação.',
    guardianMinor:
      'As contas de encarregado de educação precisam da data de nascimento de um adulto.',
    createUnavailable:
      'Não foi possível criar a sua conta neste momento. Tente novamente daqui a pouco.',
    alreadyRegistered:
      'Este endereço Google já tem uma conta CoutureCast. A iniciar sessão…',
    noSession:
      'O seu início de sessão com o Google terminou. Recomece em Iniciar sessão.',
    guardianTitle: 'Convida o teu encarregado de educação',
    guardianIntro: 'Pede ao teu encarregado de educação que aprove a tua conta.',
    guardianEmail: 'Email do encarregado de educação',
    consentLevel: 'Nível de consentimento',
    readOnly: 'Apenas leitura',
    fullAccess: 'Acesso total',
    readOnlyConsent: 'Consentimento apenas de leitura',
    fullAccessConsent: 'Consentimento de acesso total',
    sendInvite: 'Enviar convite',
    sendingInvite: 'A enviar convite…',
    inviteSent:
      'Enviámos um convite para {email}. Partilha a ligação se a pessoa não vir o e-mail.',
    invalidGuardianEmail: 'Introduza um email válido do encarregado de educação.',
    inviteFailed: 'Não foi possível enviar o convite. Tente novamente.',
    signupEyebrow: 'Verificação da idade',
    signupHeading: 'Indica a tua data de nascimento',
    signupIntro: 'Tens de ter 13 anos ou mais para criar uma conta.',
    backHome: 'Voltar ao início',
    email: 'Endereço de e-mail',
    signupCreated: 'Conta criada. Inicie sessão com o seu e-mail para continuar.',
  },
}

/** The clients' base-language fallbacks (web i18n `BASE_LANGUAGE_FALLBACK`), kept in step. */
const BASE_LANGUAGE_FALLBACK: Readonly<Record<string, SupportedSigninLocale>> = {
  en: 'en-US',
  de: 'de-DE',
  es: 'es-419',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-PT',
  tr: 'tr-TR',
}

/** An exact supported locale first, then the base language's default region, then en-US. */
export function resolveFederatedSignInLocale(
  locale: string | undefined
): SupportedSigninLocale {
  if (!locale) return 'en-US'
  const [language = '', region] = locale.replace(/_/g, '-').split('-')
  const normalized = region
    ? `${language.toLowerCase()}-${region.toUpperCase()}`
    : language.toLowerCase()
  const exact = SUPPORTED_SIGNIN_LOCALES.find((supported) => supported === normalized)
  return exact ?? BASE_LANGUAGE_FALLBACK[language.toLowerCase()] ?? 'en-US'
}

export function getFederatedSignInStrings(
  locale: string | undefined
): FederatedSignInStrings {
  return FEDERATED_SIGNIN_STRINGS[resolveFederatedSignInLocale(locale)]
}

export function getBirthdateNotice(
  evaluation: BirthdateAgeGateEvaluation,
  strings: FederatedSignInStrings
): string | null {
  if (evaluation.kind === 'invalid') return strings.invalidBirthdate
  if (evaluation.gate?.accountStatus === 'blocked_underage') return strings.underage
  if (evaluation.gate?.accountStatus === 'pending_guardian_consent') {
    return strings.guardianRequired
  }
  return null
}
