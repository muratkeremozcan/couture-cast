// Story 6.17 D11: Google sign-in and finish-step copy for the ten supported locales, shared
// by web and mobile so both clients say the same thing for the same outcome.
import { SUPPORTED_SIGNIN_LOCALES, type SupportedSigninLocale } from './locales'

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
  continue: string
  underage: string
  invalidBirthdate: string
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
    finishTitle: 'Finish creating your account',
    finishIntro:
      'You are signed in with Google. Add your birthdate to create your CoutureCast account.',
    googleAccount: 'Google account',
    birthdate: 'Birthdate',
    birthdateHint: 'We use your birthdate only to check who can use CoutureCast.',
    create: 'Create account',
    creating: 'Creating account…',
    cancel: 'Cancel',
    cancelling: 'Cancelling…',
    createdGuardianPending:
      'Account created. A guardian needs to approve your account before wardrobe features turn on.',
    continue: 'Continue',
    underage: 'You must be 13 or older to use CoutureCast.',
    invalidBirthdate: 'Enter your birthdate as a full date.',
    guardianMinor: 'Guardian accounts need an adult birthdate.',
    createUnavailable:
      'Your account could not be created right now. Try again in a moment.',
    alreadyRegistered:
      'This Google address already has a CoutureCast account. Signing you in…',
    noSession: 'Your Google sign-in has ended. Start again from Sign in.',
    guardianTitle: 'Guardian invitation',
    guardianIntro: 'Invite a guardian to approve access for this teen account.',
    guardianEmail: 'Guardian email',
    consentLevel: 'Consent level',
    readOnly: 'Read only',
    fullAccess: 'Full access',
    readOnlyConsent: 'Read only consent',
    fullAccessConsent: 'Full access consent',
    sendInvite: 'Send guardian invite',
    sendingInvite: 'Sending invite…',
    inviteSent:
      'Guardian invitation sent to {email}. Share the link below if they do not see the email.',
    invalidGuardianEmail: 'Enter a valid guardian email address.',
    inviteFailed: 'The guardian invitation could not be sent. Try again.',
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
    finishTitle: 'Finish creating your account',
    finishIntro:
      'You are signed in with Google. Add your birthdate to create your CoutureCast account.',
    googleAccount: 'Google account',
    birthdate: 'Birthdate',
    birthdateHint: 'We use your birthdate only to check who can use CoutureCast.',
    create: 'Create account',
    creating: 'Creating account…',
    cancel: 'Cancel',
    cancelling: 'Cancelling…',
    createdGuardianPending:
      'Account created. A guardian needs to approve your account before wardrobe features turn on.',
    continue: 'Continue',
    underage: 'You must be 13 or older to use CoutureCast.',
    invalidBirthdate: 'Enter your birthdate as a full date.',
    guardianMinor: 'Guardian accounts need an adult birthdate.',
    createUnavailable:
      'Your account could not be created right now. Try again in a moment.',
    alreadyRegistered:
      'This Google address already has a CoutureCast account. Signing you in…',
    noSession: 'Your Google sign-in has ended. Start again from Sign in.',
    guardianTitle: 'Guardian invitation',
    guardianIntro: 'Invite a guardian to approve access for this teen account.',
    guardianEmail: 'Guardian email',
    consentLevel: 'Consent level',
    readOnly: 'Read only',
    fullAccess: 'Full access',
    readOnlyConsent: 'Read only consent',
    fullAccessConsent: 'Full access consent',
    sendInvite: 'Send guardian invite',
    sendingInvite: 'Sending invite…',
    inviteSent:
      'Guardian invitation sent to {email}. Share the link below if they do not see the email.',
    invalidGuardianEmail: 'Enter a valid guardian email address.',
    inviteFailed: 'The guardian invitation could not be sent. Try again.',
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
    finishTitle: 'Termina de crear tu cuenta',
    finishIntro:
      'Iniciaste sesión con Google. Agrega tu fecha de nacimiento para crear tu cuenta de CoutureCast.',
    googleAccount: 'Cuenta de Google',
    birthdate: 'Fecha de nacimiento',
    birthdateHint:
      'Solo usamos tu fecha de nacimiento para comprobar quién puede usar CoutureCast.',
    create: 'Crear cuenta',
    creating: 'Creando cuenta…',
    cancel: 'Cancelar',
    cancelling: 'Cancelando…',
    createdGuardianPending:
      'Cuenta creada. Un tutor debe aprobar tu cuenta antes de que se activen las funciones del guardarropa.',
    continue: 'Continuar',
    underage: 'Debes tener 13 años o más para usar CoutureCast.',
    invalidBirthdate: 'Escribe tu fecha de nacimiento completa.',
    guardianMinor: 'Las cuentas de tutor necesitan una fecha de nacimiento de un adulto.',
    createUnavailable:
      'No pudimos crear tu cuenta en este momento. Vuelve a intentarlo en un momento.',
    alreadyRegistered:
      'Esta dirección de Google ya tiene una cuenta de CoutureCast. Iniciando sesión…',
    noSession:
      'Tu inicio de sesión con Google terminó. Vuelve a empezar desde Iniciar sesión.',
    guardianTitle: 'Invitación al tutor',
    guardianIntro:
      'Invita a un tutor para que apruebe el acceso de esta cuenta adolescente.',
    guardianEmail: 'Correo del tutor',
    consentLevel: 'Nivel de consentimiento',
    readOnly: 'Solo lectura',
    fullAccess: 'Acceso completo',
    readOnlyConsent: 'Consentimiento de solo lectura',
    fullAccessConsent: 'Consentimiento de acceso completo',
    sendInvite: 'Enviar invitación al tutor',
    sendingInvite: 'Enviando invitación…',
    inviteSent:
      'Invitación enviada a {email}. Comparte el enlace de abajo si no ve el correo.',
    invalidGuardianEmail: 'Escribe un correo válido para el tutor.',
    inviteFailed: 'No se pudo enviar la invitación al tutor. Vuelve a intentarlo.',
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
    finishTitle: 'Terminez la création de votre compte',
    finishIntro:
      'Vous êtes connecté avec Google. Ajoutez votre date de naissance pour créer votre compte CoutureCast.',
    googleAccount: 'Compte Google',
    birthdate: 'Date de naissance',
    birthdateHint:
      'Nous utilisons votre date de naissance uniquement pour vérifier qui peut utiliser CoutureCast.',
    create: 'Créer le compte',
    creating: 'Création du compte…',
    cancel: 'Annuler',
    cancelling: 'Annulation…',
    createdGuardianPending:
      "Compte créé. Un parent ou tuteur doit approuver votre compte avant que les fonctions de garde-robe s'activent.",
    continue: 'Continuer',
    underage: 'Vous devez avoir 13 ans ou plus pour utiliser CoutureCast.',
    invalidBirthdate: 'Entrez votre date de naissance complète.',
    guardianMinor: "Les comptes de tuteur exigent une date de naissance d'adulte.",
    createUnavailable:
      "Votre compte n'a pas pu être créé pour le moment. Réessayez dans un instant.",
    alreadyRegistered:
      'Cette adresse Google a déjà un compte CoutureCast. Connexion en cours…',
    noSession:
      'Votre connexion avec Google a pris fin. Recommencez à partir de Se connecter.',
    guardianTitle: 'Invitation au tuteur',
    guardianIntro:
      "Invitez un parent ou tuteur à approuver l'accès de ce compte adolescent.",
    guardianEmail: 'Courriel du tuteur',
    consentLevel: 'Niveau de consentement',
    readOnly: 'Lecture seule',
    fullAccess: 'Accès complet',
    readOnlyConsent: 'Consentement en lecture seule',
    fullAccessConsent: "Consentement d'accès complet",
    sendInvite: "Envoyer l'invitation au tuteur",
    sendingInvite: "Envoi de l'invitation…",
    inviteSent:
      "Invitation envoyée à {email}. Partagez le lien ci-dessous s'il ne voit pas le courriel.",
    invalidGuardianEmail: 'Entrez une adresse courriel valide pour le tuteur.',
    inviteFailed: "L'invitation au tuteur n'a pas pu être envoyée. Réessayez.",
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
    finishTitle: 'Terminez la création de votre compte',
    finishIntro:
      'Vous êtes connecté avec Google. Ajoutez votre date de naissance pour créer votre compte CoutureCast.',
    googleAccount: 'Compte Google',
    birthdate: 'Date de naissance',
    birthdateHint:
      'Nous utilisons votre date de naissance uniquement pour vérifier qui peut utiliser CoutureCast.',
    create: 'Créer le compte',
    creating: 'Création du compte…',
    cancel: 'Annuler',
    cancelling: 'Annulation…',
    createdGuardianPending:
      "Compte créé. Un parent ou tuteur doit approuver votre compte avant l'activation des fonctions de garde-robe.",
    continue: 'Continuer',
    underage: 'Vous devez avoir 13 ans ou plus pour utiliser CoutureCast.',
    invalidBirthdate: 'Saisissez votre date de naissance complète.',
    guardianMinor: "Les comptes de tuteur exigent une date de naissance d'adulte.",
    createUnavailable:
      "Votre compte n'a pas pu être créé pour le moment. Réessayez dans un instant.",
    alreadyRegistered:
      'Cette adresse Google a déjà un compte CoutureCast. Connexion en cours…',
    noSession: 'Votre connexion avec Google a pris fin. Recommencez depuis Se connecter.',
    guardianTitle: 'Invitation au tuteur',
    guardianIntro:
      "Invitez un parent ou tuteur à approuver l'accès de ce compte adolescent.",
    guardianEmail: 'E-mail du tuteur',
    consentLevel: 'Niveau de consentement',
    readOnly: 'Lecture seule',
    fullAccess: 'Accès complet',
    readOnlyConsent: 'Consentement en lecture seule',
    fullAccessConsent: "Consentement d'accès complet",
    sendInvite: "Envoyer l'invitation au tuteur",
    sendingInvite: "Envoi de l'invitation…",
    inviteSent:
      "Invitation envoyée à {email}. Partagez le lien ci-dessous s'il ne voit pas l'e-mail.",
    invalidGuardianEmail: 'Saisissez une adresse e-mail valide pour le tuteur.',
    inviteFailed: "L'invitation au tuteur n'a pas pu être envoyée. Réessayez.",
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
    finishTitle: 'Hesabınızı oluşturmayı tamamlayın',
    finishIntro:
      'Google ile giriş yaptınız. CoutureCast hesabınızı oluşturmak için doğum tarihinizi ekleyin.',
    googleAccount: 'Google hesabı',
    birthdate: 'Doğum tarihi',
    birthdateHint:
      "Doğum tarihinizi yalnızca CoutureCast'i kimlerin kullanabileceğini kontrol etmek için kullanırız.",
    create: 'Hesap oluştur',
    creating: 'Hesap oluşturuluyor…',
    cancel: 'İptal',
    cancelling: 'İptal ediliyor…',
    createdGuardianPending:
      'Hesap oluşturuldu. Gardırop özellikleri açılmadan önce bir velinin hesabınızı onaylaması gerekir.',
    continue: 'Devam',
    underage: "CoutureCast'i kullanmak için en az 13 yaşında olmalısınız.",
    invalidBirthdate: 'Doğum tarihinizi tam tarih olarak girin.',
    guardianMinor: 'Veli hesapları için yetişkin doğum tarihi gerekir.',
    createUnavailable: 'Hesabınız şu anda oluşturulamadı. Biraz sonra tekrar deneyin.',
    alreadyRegistered:
      'Bu Google adresinin zaten bir CoutureCast hesabı var. Giriş yapılıyor…',
    noSession: 'Google ile girişiniz sona erdi. Giriş yap sayfasından yeniden başlayın.',
    guardianTitle: 'Veli daveti',
    guardianIntro: 'Bu genç hesabının erişimini onaylaması için bir veli davet edin.',
    guardianEmail: 'Veli e-postası',
    consentLevel: 'Onay düzeyi',
    readOnly: 'Salt okunur',
    fullAccess: 'Tam erişim',
    readOnlyConsent: 'Salt okunur onay',
    fullAccessConsent: 'Tam erişim onayı',
    sendInvite: 'Veli daveti gönder',
    sendingInvite: 'Davet gönderiliyor…',
    inviteSent:
      'Davet {email} adresine gönderildi. E-postayı görmezse aşağıdaki bağlantıyı paylaşın.',
    invalidGuardianEmail: 'Geçerli bir veli e-posta adresi girin.',
    inviteFailed: 'Veli daveti gönderilemedi. Tekrar deneyin.',
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
    finishTitle: 'Konto fertig erstellen',
    finishIntro:
      'Du bist mit Google angemeldet. Gib dein Geburtsdatum ein, um dein CoutureCast-Konto zu erstellen.',
    googleAccount: 'Google-Konto',
    birthdate: 'Geburtsdatum',
    birthdateHint:
      'Wir verwenden dein Geburtsdatum nur, um zu prüfen, wer CoutureCast nutzen darf.',
    create: 'Konto erstellen',
    creating: 'Konto wird erstellt…',
    cancel: 'Abbrechen',
    cancelling: 'Wird abgebrochen…',
    createdGuardianPending:
      'Konto erstellt. Eine erziehungsberechtigte Person muss dein Konto genehmigen, bevor die Kleiderschrank-Funktionen aktiv werden.',
    continue: 'Weiter',
    underage: 'Du musst mindestens 13 Jahre alt sein, um CoutureCast zu nutzen.',
    invalidBirthdate: 'Gib dein vollständiges Geburtsdatum ein.',
    guardianMinor:
      'Konten von Erziehungsberechtigten brauchen das Geburtsdatum einer erwachsenen Person.',
    createUnavailable:
      'Dein Konto konnte gerade nicht erstellt werden. Versuche es gleich noch einmal.',
    alreadyRegistered:
      'Für diese Google-Adresse gibt es bereits ein CoutureCast-Konto. Du wirst angemeldet…',
    noSession: 'Deine Anmeldung mit Google ist beendet. Starte erneut über Anmelden.',
    guardianTitle: 'Einladung an Erziehungsberechtigte',
    guardianIntro:
      'Lade eine erziehungsberechtigte Person ein, den Zugang für dieses Teenager-Konto zu genehmigen.',
    guardianEmail: 'E-Mail der erziehungsberechtigten Person',
    consentLevel: 'Einwilligungsstufe',
    readOnly: 'Nur lesen',
    fullAccess: 'Vollzugriff',
    readOnlyConsent: 'Einwilligung nur zum Lesen',
    fullAccessConsent: 'Einwilligung für Vollzugriff',
    sendInvite: 'Einladung senden',
    sendingInvite: 'Einladung wird gesendet…',
    inviteSent:
      'Einladung an {email} gesendet. Teile den Link unten, falls die E-Mail nicht ankommt.',
    invalidGuardianEmail:
      'Gib eine gültige E-Mail-Adresse der erziehungsberechtigten Person ein.',
    inviteFailed: 'Die Einladung konnte nicht gesendet werden. Versuche es erneut.',
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
    finishTitle: 'Completa la creazione del tuo account',
    finishIntro:
      "Hai effettuato l'accesso con Google. Aggiungi la tua data di nascita per creare il tuo account CoutureCast.",
    googleAccount: 'Account Google',
    birthdate: 'Data di nascita',
    birthdateHint:
      'Usiamo la tua data di nascita solo per verificare chi può usare CoutureCast.',
    create: 'Crea account',
    creating: "Creazione dell'account…",
    cancel: 'Annulla',
    cancelling: 'Annullamento…',
    createdGuardianPending:
      'Account creato. Un genitore o tutore deve approvare il tuo account prima che le funzioni del guardaroba si attivino.',
    continue: 'Continua',
    underage: 'Devi avere almeno 13 anni per usare CoutureCast.',
    invalidBirthdate: 'Inserisci la tua data di nascita completa.',
    guardianMinor: 'Gli account dei tutori richiedono la data di nascita di un adulto.',
    createUnavailable:
      'Non è stato possibile creare il tuo account in questo momento. Riprova tra poco.',
    alreadyRegistered:
      'Questo indirizzo Google ha già un account CoutureCast. Accesso in corso…',
    noSession: "L'accesso con Google è terminato. Ricomincia da Accedi.",
    guardianTitle: 'Invito al tutore',
    guardianIntro:
      "Invita un genitore o tutore ad approvare l'accesso di questo account adolescente.",
    guardianEmail: 'Email del tutore',
    consentLevel: 'Livello di consenso',
    readOnly: 'Sola lettura',
    fullAccess: 'Accesso completo',
    readOnlyConsent: 'Consenso in sola lettura',
    fullAccessConsent: 'Consenso ad accesso completo',
    sendInvite: 'Invia invito al tutore',
    sendingInvite: "Invio dell'invito…",
    inviteSent:
      "Invito inviato a {email}. Condividi il link qui sotto se non vede l'email.",
    invalidGuardianEmail: 'Inserisci un indirizzo email valido per il tutore.',
    inviteFailed: "Non è stato possibile inviare l'invito al tutore. Riprova.",
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
    finishTitle: 'Termine de criar sua conta',
    finishIntro:
      'Você entrou com o Google. Adicione sua data de nascimento para criar sua conta do CoutureCast.',
    googleAccount: 'Conta do Google',
    birthdate: 'Data de nascimento',
    birthdateHint:
      'Usamos sua data de nascimento só para verificar quem pode usar o CoutureCast.',
    create: 'Criar conta',
    creating: 'Criando conta…',
    cancel: 'Cancelar',
    cancelling: 'Cancelando…',
    createdGuardianPending:
      'Conta criada. Um responsável precisa aprovar sua conta antes que os recursos do guarda-roupa sejam ativados.',
    continue: 'Continuar',
    underage: 'Você precisa ter 13 anos ou mais para usar o CoutureCast.',
    invalidBirthdate: 'Digite sua data de nascimento completa.',
    guardianMinor: 'Contas de responsável precisam da data de nascimento de um adulto.',
    createUnavailable:
      'Não foi possível criar sua conta agora. Tente de novo em instantes.',
    alreadyRegistered:
      'Este endereço do Google já tem uma conta do CoutureCast. Entrando…',
    noSession: 'Seu login com o Google terminou. Comece de novo em Entrar.',
    guardianTitle: 'Convite ao responsável',
    guardianIntro:
      'Convide um responsável para aprovar o acesso desta conta de adolescente.',
    guardianEmail: 'E-mail do responsável',
    consentLevel: 'Nível de consentimento',
    readOnly: 'Somente leitura',
    fullAccess: 'Acesso total',
    readOnlyConsent: 'Consentimento somente leitura',
    fullAccessConsent: 'Consentimento de acesso total',
    sendInvite: 'Enviar convite ao responsável',
    sendingInvite: 'Enviando convite…',
    inviteSent:
      'Convite enviado para {email}. Compartilhe o link abaixo se a pessoa não vir o e-mail.',
    invalidGuardianEmail: 'Digite um e-mail válido para o responsável.',
    inviteFailed: 'Não foi possível enviar o convite ao responsável. Tente de novo.',
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
    finishTitle: 'Termine de criar a sua conta',
    finishIntro:
      'Iniciou sessão com o Google. Adicione a sua data de nascimento para criar a sua conta CoutureCast.',
    googleAccount: 'Conta Google',
    birthdate: 'Data de nascimento',
    birthdateHint:
      'Usamos a sua data de nascimento apenas para verificar quem pode usar o CoutureCast.',
    create: 'Criar conta',
    creating: 'A criar conta…',
    cancel: 'Cancelar',
    cancelling: 'A cancelar…',
    createdGuardianPending:
      'Conta criada. Um encarregado de educação tem de aprovar a sua conta antes de as funcionalidades do guarda-roupa ficarem ativas.',
    continue: 'Continuar',
    underage: 'Tem de ter 13 anos ou mais para usar o CoutureCast.',
    invalidBirthdate: 'Introduza a sua data de nascimento completa.',
    guardianMinor:
      'As contas de encarregado de educação precisam da data de nascimento de um adulto.',
    createUnavailable:
      'Não foi possível criar a sua conta neste momento. Tente novamente daqui a pouco.',
    alreadyRegistered:
      'Este endereço Google já tem uma conta CoutureCast. A iniciar sessão…',
    noSession:
      'O seu início de sessão com o Google terminou. Recomece em Iniciar sessão.',
    guardianTitle: 'Convite ao encarregado de educação',
    guardianIntro:
      'Convide um encarregado de educação a aprovar o acesso desta conta de adolescente.',
    guardianEmail: 'Email do encarregado de educação',
    consentLevel: 'Nível de consentimento',
    readOnly: 'Apenas leitura',
    fullAccess: 'Acesso total',
    readOnlyConsent: 'Consentimento apenas de leitura',
    fullAccessConsent: 'Consentimento de acesso total',
    sendInvite: 'Enviar convite',
    sendingInvite: 'A enviar convite…',
    inviteSent:
      'Convite enviado para {email}. Partilhe a ligação abaixo se não vir o email.',
    invalidGuardianEmail: 'Introduza um email válido do encarregado de educação.',
    inviteFailed: 'Não foi possível enviar o convite. Tente novamente.',
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
