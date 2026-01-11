import { type RESTPostAPIChannelMessageJSONBody, MessageFlags, ComponentType, ButtonStyle } from "discord-api-types/v10";


interface TranslationKeys {
  banActionFull: string;
  banActionShort: string;
  bannedActionShort: string;
  softbanActionFull: string;
  softbanActionShort: string;
  softbannedActionShort: string;
  disabledActionFull: string;
  disabledActionShort: string;

  honeypotWarningMessage: string;

  dmMessageIntro: string;
  dmMessageFooter: string;
  dmMessageOwner: string;
}

const honeypotWarningMessageTranslations: Record<string, Partial<TranslationKeys> | undefined> & { en: TranslationKeys } = {
  /** English */
  en: {
    banActionFull: 'an immediate ban',
    banActionShort: 'Bans',
    bannedActionShort: 'Banned',
    softbanActionFull: 'a softban',
    softbanActionShort: 'Kicks',
    softbannedActionShort: 'Kicked',
    disabledActionFull: 'no action (honeypot is disabled)',
    disabledActionShort: 'Triggers',

    honeypotWarningMessage: 'DO NOT SEND MESSAGES IN THIS CHANNEL\n\nThis channel is used to catch spam bots. Any messages sent here will result in {{action}}.',

    dmMessageIntro: '## Honeypot Triggered\n\nYou have been **{{actionText}}** from {{guildName}} for sending a message in the [honeypot]({{link}}) channel.',
    dmMessageFooter: '-# This is an automated message. Replies are not monitored.',
    dmMessageOwner: '-# This is an example message: as the owner you can’t be {{actionText}}.'
  },
  /** English, UK; same as en */
  "en-GB": undefined,
  /** English, US; same as en */
  "en-US": undefined,

  /** Indonesian */
  id: {
    banActionFull: 'pemblokiran permanen',
    banActionShort: 'Blokir',
    bannedActionShort: 'Diblokir',
    softbanActionFull: 'pengusiran sementara',
    softbanActionShort: 'Tendang',
    softbannedActionShort: 'Ditendang',
    disabledActionFull: 'tanpa tindakan (honeypot dinonaktifkan)',
    disabledActionShort: 'Memicu',

    honeypotWarningMessage: 'JANGAN KIRIM PESAN DI SALURAN INI\n\nSaluran ini digunakan untuk menangkap bot spam. Pesan yang dikirim di sini akan berakibat {{action}}.',

    dmMessageIntro: '## Honeypot Aktif\n\nAnda telah **{{actionText}}** dari {{guildName}} karena mengirim pesan di saluran [honeypot]({{link}}).',
    dmMessageFooter: '-# Ini pesan otomatis. Balasan tidak dipantau.',
    dmMessageOwner: '-# Ini pesan contoh: sebagai pemilik Anda tidak bisa {{actionText}}.'
  },

  /** Danish */
  da: {
    banActionFull: 'en øjeblikkelig udelukkelse',
    banActionShort: 'Udelukker',
    bannedActionShort: 'Udelukket',
    softbanActionFull: 'en midlertidig udsmidning',
    softbanActionShort: 'Sparker',
    softbannedActionShort: 'Sparket',
    disabledActionFull: 'ingen handling (honeypot er deaktiveret)',
    disabledActionShort: 'Udløser',

    honeypotWarningMessage: 'SEND IKKE BESKEDER I DENNE KANAL\n\nDenne kanal bruges til at fange spambotter. Beskeder sendt her medfører {{action}}.',

    dmMessageIntro: '## Honeypot Udløst\n\nDu er blevet **{{actionText}}** fra {{guildName}} for at sende en besked i [honeypot]({{link}})-kanalen.',
    dmMessageFooter: '-# Dette er en automatisk besked. Svar overvåges ikke.',
    dmMessageOwner: '-# Dette er et eksempel: som ejer kan du ikke blive {{actionText}}.'
  },

  /** German */
  de: {
    banActionFull: 'ein sofortiger Bann',
    banActionShort: 'Bannt',
    bannedActionShort: 'Gebannt',
    softbanActionFull: 'ein Kick',
    softbanActionShort: 'Kickt',
    softbannedActionShort: 'Gekickt',
    disabledActionFull: 'keine Aktion (Honeypot ist deaktiviert)',
    disabledActionShort: 'Löst aus',

    honeypotWarningMessage: 'KEINE NACHRICHTEN IN DIESEM KANAL SENDEN\n\nDieser Kanal wird verwendet, um Spam-Bots zu fangen. Nachrichten hier führen zu {{action}}.',

    dmMessageIntro: '## Honeypot Ausgelöst\n\nDu wurdest **{{actionText}}** aus {{guildName}} für das Senden einer Nachricht im [Honeypot]({{link}})-Kanal.',
    dmMessageFooter: '-# Dies ist eine automatische Nachricht. Antworten werden nicht überwacht.',
    dmMessageOwner: '-# Dies ist eine Beispielnachricht: Als Besitzer kannst du nicht {{actionText}} werden.'
  },

  /** Spanish */
  "es": {
    banActionFull: 'un baneo inmediato',
    banActionShort: 'Banea',
    bannedActionShort: 'Baneado',
    softbanActionFull: 'una expulsión',
    softbanActionShort: 'Expulsa',
    softbannedActionShort: 'Expulsado',
    disabledActionFull: 'sin acción (honeypot desactivado)',
    disabledActionShort: 'Activa',

    honeypotWarningMessage: 'NO ENVÍES MENSAJES EN ESTE CANAL\n\nEste canal se usa para atrapar bots de spam. Cualquier mensaje enviado aquí resultará en {{action}}.',

    dmMessageIntro: '## Honeypot Activado\n\nHas sido **{{actionText}}** de {{guildName}} por enviar un mensaje en el canal de [honeypot]({{link}}).',
    dmMessageFooter: '-# Este es un mensaje automático. Las respuestas no se revisan.',
    dmMessageOwner: '-# Este es un mensaje de ejemplo: como propietario no puedes ser {{actionText}}.'
  },
  /** Spanish (Spain); same as es */
  "es-ES": undefined,
  /** Spanish (LATAM); same as es */
  "es-419": undefined,
 
  /** French */
   fr: {
    banActionFull: 'une exclusion immédiate',
    banActionShort: 'Bannit',
    bannedActionShort: 'Banni',
    softbanActionFull: 'une exclusion temporaire',
    softbanActionShort: 'Expulse',
    softbannedActionShort: 'Expulsé',
    disabledActionFull: 'aucune action (honeypot désactivé)',
    disabledActionShort: 'Déclenche',

    honeypotWarningMessage: 'NE PAS ENVOYER DE MESSAGES DANS CE SALON\n\nCe salon est utilisé pour piéger les bots de spam. Tout message envoyé ici entraînera {{action}}.',

    dmMessageIntro: '## Honeypot Déclenché\n\nVous avez été **{{actionText}}** de {{guildName}} pour avoir envoyé un message dans le salon [honeypot]({{link}}).',
    dmMessageFooter: '-# Ceci est un message automatique. Les réponses ne sont pas surveillées.',
    dmMessageOwner: '-# Ceci est un message d’exemple : en tant que propriétaire, vous ne pouvez pas être {{actionText}}.'
  },

  /** Croatian */
  hr: {
    banActionFull: 'trenutna zabrana',
    banActionShort: 'Zabranjuje',
    bannedActionShort: 'Zabranjen',
    softbanActionFull: 'izbacivanje',
    softbanActionShort: 'Izbacuje',
    softbannedActionShort: 'Izbačen',
    disabledActionFull: 'bez akcije (honeypot je onemogućen)',
    disabledActionShort: 'Okida',

    honeypotWarningMessage: 'NEMOJ SLATI PORUKE U OVOM KANALU\n\nOvaj kanal se koristi za hvatanje spam botova. Poruke ovdje rezultiraju {{action}}.',

    dmMessageIntro: '## Honeypot Aktiviran\n\n**{{actionText}}** si iz {{guildName}} zbog slanja poruke u [honeypot]({{link}}) kanalu.',
    dmMessageFooter: '-# Ovo je automatska poruka. Odgovori se ne prate.',
    dmMessageOwner: '-# Ovo je primjer poruke: kao vlasnik ne možeš biti {{actionText}}.'
  },

  /** Italian */
  it: {
    banActionFull: 'un ban immediato',
    banActionShort: 'Banna',
    bannedActionShort: 'Bannato',
    softbanActionFull: 'un’espulsione',
    softbanActionShort: 'Espelle',
    softbannedActionShort: 'Espulso',
    disabledActionFull: 'nessuna azione (honeypot disabilitato)',
    disabledActionShort: 'Attiva',

    honeypotWarningMessage: 'NON INVIARE MESSAGGI IN QUESTO CANALE\n\nQuesto canale è usato per individuare bot spam. Qualsiasi messaggio inviato qui comporterà {{action}}.',

    dmMessageIntro: '## Honeypot Attivato\n\nSei stato **{{actionText}}** da {{guildName}} per aver inviato un messaggio nel canale [honeypot]({{link}}).',
    dmMessageFooter: '-# Questo è un messaggio automatico. Le risposte non sono monitorate.',
    dmMessageOwner: '-# Questo è un messaggio di esempio: come proprietario non puoi essere {{actionText}}.'
  },

  /** Lithuanian */
  lt: {
    banActionFull: 'nedelsiant užblokuojama',
    banActionShort: 'Blokuoja',
    bannedActionShort: 'Užblokuotas',
    softbanActionFull: 'laikinas pašalinimas',
    softbanActionShort: 'Išmeta',
    softbannedActionShort: 'Išmestas',
    disabledActionFull: 'jokių veiksmų (honeypot išjungtas)',
    disabledActionShort: 'Sukelia',

    honeypotWarningMessage: 'NESIŲSKITE ŽINUČIŲ ŠIAME KANALE\n\nŠis kanalas naudojamas šlamšto botams pagauti. Bet kuri žinutė čia sukels {{action}}.',

    dmMessageIntro: '## Honeypot Įjungtas\n\nJūs buvote **{{actionText}}** iš {{guildName}} už žinutės siuntimą [honeypot]({{link}}) kanale.',
    dmMessageFooter: '-# Tai automatinė žinutė. Atsakymai nestebimi.',
    dmMessageOwner: '-# Tai pavyzdinė žinutė: kaip savininkas jūs negalite būti {{actionText}}.'
  },

  /** Hungarian */
  hu: {
    banActionFull: 'azonnali kitiltás',
    banActionShort: 'Kitilt',
    bannedActionShort: 'Kitiltva',
    softbanActionFull: 'ideiglenes kizárás',
    softbanActionShort: 'Kirúg',
    softbannedActionShort: 'Kirúgva',
    disabledActionFull: 'nincs művelet (honeypot letiltva)',
    disabledActionShort: 'Kivált',

    honeypotWarningMessage: 'NE KÜLDJ ÜZENETET EBBE A CSATORNÁBA\n\nEzt a csatornát spam botok kifogására használjuk. Az itt küldött üzenetek eredménye: {{action}}.',

    dmMessageIntro: '## Honeypot Aktiválva\n\n**{{actionText}}** lettél a {{guildName}} szerverről, mert üzenetet küldtél a [honeypot]({{link}}) csatornában.',
    dmMessageFooter: '-# Ez egy automatikus üzenet. A válaszokat nem figyeljük.',
    dmMessageOwner: '-# Ez egy példaüzenet: tulajdonosként nem lehetsz {{actionText}}.'
  },

  /** Dutch */
  nl: {
    banActionFull: 'een directe ban',
    banActionShort: 'Bant',
    bannedActionShort: 'Geband',
    softbanActionFull: 'een verwijdering',
    softbanActionShort: 'Kickt',
    softbannedActionShort: 'Gekickt',
    disabledActionFull: 'geen actie (honeypot is uitgeschakeld)',
    disabledActionShort: 'Triggert',

    honeypotWarningMessage: 'GEEN BERICHTEN IN DIT KANAAL STUREN\n\nDit kanaal wordt gebruikt om spam-bots te vangen. Berichten hier leiden tot {{action}}.',

    dmMessageIntro: '## Honeypot Geactiveerd\n\nJe bent **{{actionText}}** uit {{guildName}} voor het sturen van een bericht in het [honeypot]({{link}})-kanaal.',
    dmMessageFooter: '-# Dit is een automatisch bericht. Antwoorden worden niet gelezen.',
    dmMessageOwner: '-# Dit is een voorbeeldbericht: als eigenaar kun je niet {{actionText}} worden.'
  },

  /** Norwegian */
  no: {
    banActionFull: 'en umiddelbar utestengelse',
    banActionShort: 'Utestenger',
    bannedActionShort: 'Utestengt',
    softbanActionFull: 'en midlertidig utkastelse',
    softbanActionShort: 'Kicker',
    softbannedActionShort: 'Kicket',
    disabledActionFull: 'ingen handling (honeypot er deaktivert)',
    disabledActionShort: 'Utløser',

    honeypotWarningMessage: 'IKKE SEND MELDINGER I DENNE KANALEN\n\nDenne kanalen brukes til å fange spamroboter. Meldinger her fører til {{action}}.',

    dmMessageIntro: '## Honeypot Utløst\n\nDu har blitt **{{actionText}}** fra {{guildName}} for å sende en melding i [honeypot]({{link}})-kanalen.',
    dmMessageFooter: '-# Dette er en automatisk melding. Svar blir ikke overvåket.',
    dmMessageOwner: '-# Dette er en eksempelmelding: som eier kan du ikke bli {{actionText}}.'
  },

  /** Polish */
  pl: {
    banActionFull: 'natychmiastowy ban',
    banActionShort: 'Banuje',
    bannedActionShort: 'Zbanowany',
    softbanActionFull: 'wyrzucenie',
    softbanActionShort: 'Wyrzuca',
    softbannedActionShort: 'Wyrzucony',
    disabledActionFull: 'brak akcji (honeypot wyłączony)',
    disabledActionShort: 'Wyzwala',

    honeypotWarningMessage: 'NIE WYSYŁAJ WIADOMOŚCI НА TEN KANAŁ\n\nTen kanał służy do łapania botów spamujących. Wysłanie wiadomości spowoduje {{action}}.',

    dmMessageIntro: '## Honeypot Aktywny\n\nZostałeś **{{actionText}}** z {{guildName}} za wysłanie wiadomości na kanale [honeypot]({{link}}).',
    dmMessageFooter: '-# To jest wiadomość automatyczna. Odpowiedzi nie są monitorowane.',
    dmMessageOwner: '-# To wiadomość przykładowa: jako właściciel nie możesz zostać {{actionText}}.'
  },

  /** Portuguese, Brazilian */
  "pt-BR": {
    banActionFull: 'um banimento imediato',
    banActionShort: 'Bane',
    bannedActionShort: 'Banido',
    softbanActionFull: 'uma expulsão',
    softbanActionShort: 'Expulsa',
    softbannedActionShort: 'Expulso',
    disabledActionFull: 'nenhuma ação (honeypot desativado)',
    disabledActionShort: 'Aciona',

    honeypotWarningMessage: 'NÃO ENVIE MENSAGENS NESTE CANAL\n\nEste canal é usado para capturar bots de spam. Qualquer mensagem enviada aqui resultará em {{action}}.',

    dmMessageIntro: '## Honeypot Ativado\n\nVocê foi **{{actionText}}** de {{guildName}} por enviar uma mensagem no canal [honeypot]({{link}}).',
    dmMessageFooter: '-# Esta é uma mensagem automática. As respostas não são monitoradas.',
    dmMessageOwner: '-# Esta é uma mensagem de exemplo: como proprietário você não pode ser {{actionText}}.'
  },

  /** Romanian */
  ro: {
    banActionFull: 'o interzicere imediată',
    banActionShort: 'Interzice',
    bannedActionShort: 'Interzis',
    softbanActionFull: 'o excludere',
    softbanActionShort: 'Exclude',
    softbannedActionShort: 'Exclus',
    disabledActionFull: 'nicio acțiune (honeypot dezactivat)',
    disabledActionShort: 'Declanșează',

    honeypotWarningMessage: 'NU TRIMITEȚI MESAJE ÎN ACEST CANAL\n\nAcest canal este folosit pentru a prinde boți de spam. Orice mesaj trimis aici va duce la {{action}}.',

    dmMessageIntro: '## Honeypot Declanșat\n\nAi fost **{{actionText}}** de pe {{guildName}} pentru că ai trimis un mesaj în canalul [honeypot]({{link}}).',
    dmMessageFooter: '-# Acesta este un mesaj automat. Răspunsurile nu sunt monitorizate.',
    dmMessageOwner: '-# Acesta este un mesaj de exemplu: ca proprietar nu poți fi {{actionText}}.'
  },

  /** Finnish */
  fi: {
    banActionFull: 'välitön porttikielto',
    banActionShort: 'Portittaa',
    bannedActionShort: 'Portitettu',
    softbanActionFull: 'tilapäinen poistaminen',
    softbanActionShort: 'Potkaisee',
    softbannedActionShort: 'Potkaistu',
    disabledActionFull: 'ei toimenpidettä (honeypot pois päältä)',
    disabledActionShort: 'Laukaisee',

    honeypotWarningMessage: 'ÄLÄ LÄHETÄ VIESTEJÄ TÄSSÄ KANAVASSA\n\nTätä kanavaa käytetään roskapostibottien kiinniottoon. Tänne lähetetyt viestit johtavat {{action}}.',

    dmMessageIntro: '## Honeypot Laukaistu\n\nSinut on **{{actionText}}** palvelimelta {{guildName}}, koska lähetit viestin [honeypot]({{link}})-kanavalle.',
    dmMessageFooter: '-# Tämä on automaattinen viesti. Vastauksia ei seurata.',
    dmMessageOwner: '-# Tämä on esimerkkiviesti: omistajana sinua ei voida {{actionText}}.'
  },

  /** Swedish */
  "sv-SE": {
    banActionFull: 'en omedelbar avstängning',
    banActionShort: 'Stänger av',
    bannedActionShort: 'Avstängd',
    softbanActionFull: 'en tillfällig utspark',
    softbanActionShort: 'Kastar ut',
    softbannedActionShort: 'Utkastad',
    disabledActionFull: 'ingen åtgärd (honeypot är avstängd)',
    disabledActionShort: 'Utlöser',

    honeypotWarningMessage: 'SKICKA INTE MEDDELANDEN I DENNA KANAL\n\nDenna kanal används för att fånga spamrobotar. Meddelanden här leder till {{action}}.',

    dmMessageIntro: '## Honeypot Utlöst\n\nDu har blivit **{{actionText}}** från {{guildName}} för att du skickade ett meddelande i [honeypot]({{link}})-kanalen.',
    dmMessageFooter: '-# Detta är ett automatiskt meddelande. Svar övervakas inte.',
    dmMessageOwner: '-# Detta är ett exempel: som ägare kan du inte bli {{actionText}}.'
  },

  /** Vietnamese */
  vi: {
    banActionFull: 'cấm vĩnh viễn ngay lập tức',
    banActionShort: 'Cấm',
    bannedActionShort: 'Đã cấm',
    softbanActionFull: 'đuổi tạm thời',
    softbanActionShort: 'Đuổi',
    softbannedActionShort: 'Đã đuổi',
    disabledActionFull: 'không hành động (honeypot đã tắt)',
    disabledActionShort: 'Kích hoạt',

    honeypotWarningMessage: 'KHÔNG GỬI TIN NHẮN TRONG KÊNH NÀY\n\nKênh này dùng để bắt bot spam. Bất kỳ tin nhắn nào ở đây sẽ dẫn đến {{action}}.',

    dmMessageIntro: '## Honeypot Kích Hoạt\n\nBạn đã bị **{{actionText}}** khỏi {{guildName}} vì gửi tin nhắn trong kênh [honeypot]({{link}}).',
    dmMessageFooter: '-# Đây là tin nhắn tự động. Phản hồi sẽ không được theo dõi.',
    dmMessageOwner: '-# Đây là tin nhắn ví dụ: với tư cách chủ sở hữu bạn không thể bị {{actionText}}.'
  },

  /** Turkish */
  tr: {
    banActionFull: 'anında yasaklama',
    banActionShort: 'Yasaklar',
    bannedActionShort: 'Yasaklandı',
    softbanActionFull: 'geçici atma',
    softbanActionShort: 'Atar',
    softbannedActionShort: 'Atıldı',
    disabledActionFull: 'işlem yok (honeypot devre dışı)',
    disabledActionShort: 'Tetikler',

    honeypotWarningMessage: 'BU KANALDA MESAJ GÖNDERMEYİN\n\nBu kanal spam botlarını yakalamak için kullanılır. Buraya gönderilen mesajlar {{action}} ile sonuçlanır.',

    dmMessageIntro: '## Honeypot Tetiklendi\n\n[honey pot]({{link}}) kanalında mesaj gönderdiğiniz için {{guildName}} sunucusundan **{{actionText}}** oldunuz.',
    dmMessageFooter: '-# Bu otomatik bir mesajdır. Yanıtlar izlenmez.',
    dmMessageOwner: '-# Bu bir örnek mesajdır: sahip olarak {{actionText}} olamazsınız.'
  },

  /** Czech */
  cs: {
    banActionFull: 'okamžitý ban',
    banActionShort: 'Banuje',
    bannedActionShort: 'Zabanován',
    softbanActionFull: 'vyhození',
    softbanActionShort: 'Vyhazuje',
    softbannedActionShort: 'Vyhozen',
    disabledActionFull: 'žádná akce (honeypot je vypnutý)',
    disabledActionShort: 'Spouští',

    honeypotWarningMessage: 'NEPOSÍLEJTE ZPRÁVY V TOMTO KANÁLU\n\nTento kanál slouží k odchytu spam botů. Zpráva zde povede k {{action}}.',

    dmMessageIntro: '## Honeypot Spuštěn\n\nByl jsi **{{actionText}}** z {{guildName}} za poslání zprávy na kanálu [honeypot]({{link}}).',
    dmMessageFooter: '-# Toto je automatická zpráva. Odpovědi se nesledují.',
    dmMessageOwner: '-# Toto je ukázková zpráva: jako vlastník nemůžeš být {{actionText}}.'
  },

  /** Greek */
  el: {
    banActionFull: 'άμεσο αποκλεισμό',
    banActionShort: 'Αποκλείει',
    bannedActionShort: 'Αποκλείστηκε',
    softbanActionFull: 'προσωρινή απομάκρυνση',
    softbanActionShort: 'Απομακρύνει',
    softbannedActionShort: 'Απομακρύνθηκε',
    disabledActionFull: 'καμία ενέργεια (το honeypot είναι απενεργοποιημένο)',
    disabledActionShort: 'Ενεργοποιεί',

    honeypotWarningMessage: 'ΜΗΝ ΣΤΕΛΝΕΤΕ ΜΗΝΥΜΑΤΑ ΣΕ ΑΥΤΟ ΤΟ ΚΑΝΑΛΙ\n\nΑυτό το κανάλι χρησιμοποιείται για να παγιδεύει spam bots. Κάθε μήνυμα εδώ θα οδηγήσει σε {{action}}.',

    dmMessageIntro: '## Honeypot Ενεργοποιήθηκε\n\nΈχετε **{{actionText}}** από το {{guildName}} επειδή στείλατε μήνυμα στο κανάλι [honeypot]({{link}}).',
    dmMessageFooter: '-# Αυτό είναι αυτοματοποιημένο μήνυμα. Οι απαντήσεις δεν παρακολουθούνται.',
    dmMessageOwner: '-# Αυτό είναι παράδειγμα: ως ιδιοκτήτης δεν μπορείτε να {{actionText}}.'
  },

  /** Bulgarian */
  bg: {
    banActionFull: 'незабавно банване',
    banActionShort: 'Банва',
    bannedActionShort: 'Баннат',
    softbanActionFull: 'временно изгонване',
    softbanActionShort: 'Гони',
    softbannedActionShort: 'Изгонен',
    disabledActionFull: 'без действие (honeypot е изключен)',
    disabledActionShort: 'Задейства',

    honeypotWarningMessage: 'НЕ ИЗПРАЩАЙТЕ СЪОБЩЕНИЯ В ТОЗИ КАНАЛ\n\nТози канал се използва за улавяне на спам ботове. Всяко изпратено съобщение ще доведе до {{action}}.',

    dmMessageIntro: '## Honeypot Задействан\n\nБяхте **{{actionText}}** от {{guildName}} за изпращане на съобщение в канала [honeypot]({{link}}).',
    dmMessageFooter: '-# Това е автоматично съобщение. Отговорите не се наблюдават.',
    dmMessageOwner: '-# Това е пример: като собственик не можете да бъдете {{actionText}}.'
  },

  /** Russian */
  ru: {
    banActionFull: 'немедленный бан',
    banActionShort: 'Банит',
    bannedActionShort: 'Забанен',
    softbanActionFull: 'выкидывание',
    softbanActionShort: 'Кикает',
    softbannedActionShort: 'Кикнут',
    disabledActionFull: 'нет действий (honeypot отключён)',
    disabledActionShort: 'Срабатывает',

    honeypotWarningMessage: 'НЕ ОТПРАВЛЯЙТЕ СООБЩЕНИЯ В ЭТОТ КАНАЛ\n\nЭтот канал используется для поимки спам-ботов. Любое сообщение здесь приведет к {{action}}.',

    dmMessageIntro: '## Honeypot Сработал\n\nВы были **{{actionText}}** с сервера {{guildName}} за отправку сообщения в канале [honeypot]({{link}}).',
    dmMessageFooter: '-# Это автоматическое сообщение. Ответы не отслеживаются.',
    dmMessageOwner: '-# Это пример сообщения: как владелец вы не можете быть {{actionText}}.'
  },

  /** Ukrainian */
  uk: {
    banActionFull: 'миттєвий бан',
    banActionShort: 'Банить',
    bannedActionShort: 'Забанено',
    softbanActionFull: 'вигнання',
    softbanActionShort: 'Виганяє',
    softbannedActionShort: 'Вигнано',
    disabledActionFull: 'без дій (honeypot вимкнено)',
    disabledActionShort: 'Спрацьовує',

    honeypotWarningMessage: 'НЕ НАДСИЛАЙТЕ ПОВІДОМЛЕННЯ В ЦЕЙ КАНАЛ\n\nЦей канал використовується для виявлення спам-ботів. Будь-яке повідомлення тут призведе до {{action}}.',

    dmMessageIntro: '## Honeypot Спрацював\n\nВас **{{actionText}}** із {{guildName}} за надсилання повідомлення в каналі [honeypot]({{link}}).',
    dmMessageFooter: '-# Це автоматичне повідомлення. Відповіді не відстежуються.',
    dmMessageOwner: '-# Це приклад повідомлення: як власник ви не можете бути {{actionText}}.'
  },

  /** Hindi */
  hi: {
    banActionFull: 'तुरंत प्रतिबंध',
    banActionShort: 'प्रतिबंधित करता है',
    bannedActionShort: 'प्रतिबंधित',
    softbanActionFull: 'अस्थायी निष्कासन',
    softbanActionShort: 'निकालता है',
    softbannedActionShort: 'निकाला गया',
    disabledActionFull: 'कोई कार्रवाई नहीं (हनीपॉट निष्क्रिय है)',
    disabledActionShort: 'ट्रिगर करता है',

    honeypotWarningMessage: 'इस चैनल में संदेश न भेजें\n\nयह चैनल स्पैम बॉट पकड़ने के लिए उपयोग किया जाता है। यहां भेजे गए किसी भी संदेश का परिणाम {{action}} होगा.',

    dmMessageIntro: '## हनीपॉट सक्रिय हुआ\n\n[honey pot]({{link}}) चैनल में संदेश भेजने के लिए आपको {{guildName}} से **{{actionText}}** किया गया है.',
    dmMessageFooter: '-# यह एक स्वचालित संदेश है। उत्तरों की निगरानी नहीं होती है.',
    dmMessageOwner: '-# यह एक उदाहरण संदेश है: मालिक होने के नाते आपको {{actionText}} नहीं किया जा सकता.'
  },

  /** Thai */
  th: {
    banActionFull: 'แบนทันที',
    banActionShort: 'แบน',
    bannedActionShort: 'ถูกแบน',
    softbanActionFull: 'การเตะชั่วคราว',
    softbanActionShort: 'เตะ',
    softbannedActionShort: 'ถูกเตะ',
    disabledActionFull: 'ไม่ดำเนินการ (ปิดใช้งาน honeypot)',
    disabledActionShort: 'ทริกเกอร์',

    honeypotWarningMessage: 'อย่าส่งข้อความในช่องนี้\n\nช่องนี้ใช้เพื่อดักจับบ็อตสแปม ข้อความใด ๆ ที่ส่งที่นี่จะส่งผลให้ {{action}}.',

    dmMessageIntro: '## Honeypot ทำงาน\n\nคุณถูก **{{actionText}}** จาก {{guildName}} เนื่องจากส่งข้อความในช่อง [honeypot]({{link}}).',
    dmMessageFooter: '-# นี่คือข้อความอัตโนมัติ ไม่ได้ติดตามการตอบกลับ.',
    dmMessageOwner: '-# นี่คือตัวอย่างข้อความ: ในฐานะเจ้าของคุณไม่สามารถถูก {{actionText}}.'
  },

  /** Chinese (China) */
  "zh-CN": {
    banActionFull: '立即封禁',
    banActionShort: '封禁',
    bannedActionShort: '已封禁',
    softbanActionFull: '临时移除',
    softbanActionShort: '踢出',
    softbannedActionShort: '已踢出',
    disabledActionFull: '无操作（honeypot 已禁用）',
    disabledActionShort: '触发',

    honeypotWarningMessage: '请勿在此频道发送消息\n\n此频道用于捕捉垃圾消息机器人。任何在此发送的消息都会导致 {{action}}。',

    dmMessageIntro: '## Honeypot 已触发\n\n由于在[honey pot]({{link}})频道发送消息，你已被从 {{guildName}} **{{actionText}}**。',
    dmMessageFooter: '-# 这是一条自动消息。回复不会被查看。',
    dmMessageOwner: '-# 这是一条示例消息：作为拥有者你不会被 {{actionText}}。'
  },

  /** Japanese */
  ja: {
    banActionFull: '即時のBAN',
    banActionShort: 'BANする',
    bannedActionShort: 'BAN済み',
    softbanActionFull: '一時的なキック',
    softbanActionShort: 'キック',
    softbannedActionShort: 'キック済み',
    disabledActionFull: '処理なし（ハニーポットは無効）',
    disabledActionShort: 'トリガー',

    honeypotWarningMessage: 'このチャンネルでメッセージを送信しないでください\n\nこのチャンネルはスパムボットを捕まえるために使用されます。ここで送信されたメッセージは{{action}}となります。',

    dmMessageIntro: '## ハニーポットが発動しました\n\n[honeypot]({{link}})チャンネルでメッセージを送信したため、{{guildName}}から**{{actionText}}**されました。',
    dmMessageFooter: '-# これは自動メッセージです。返信は確認されません。',
    dmMessageOwner: '-# これは例のメッセージです。所有者として{{actionText}}されることはありません。'
  },

  /** Chinese (Taiwan) */
  "zh-TW": {
    banActionFull: '立即封鎖',
    banActionShort: '封鎖',
    bannedActionShort: '已封鎖',
    softbanActionFull: '暫時移除',
    softbanActionShort: '踢出',
    softbannedActionShort: '已踢出',
    disabledActionFull: '無動作（honeypot 已停用）',
    disabledActionShort: '觸發',

    honeypotWarningMessage: '請勿在此頻道發送訊息\n\n此頻道用於抓取垃圾訊息機器人。任何在此發送的訊息都會導致 {{action}}。',

    dmMessageIntro: '## Honeypot 已觸發\n\n由於在 [honeypot]({{link}}) 頻道發送訊息，你已被從 {{guildName}} **{{actionText}}**。',
    dmMessageFooter: '-# 這是自動訊息。回覆不會被查看。',
    dmMessageOwner: '-# 這是範例訊息：作為擁有者你不會被 {{actionText}}。'
  },

  /** Korean */
  ko: {
    banActionFull: '즉시 차단',
    banActionShort: '차단',
    bannedActionShort: '차단됨',
    softbanActionFull: '임시 추방',
    softbanActionShort: '추방',
    softbannedActionShort: '추방됨',
    disabledActionFull: '조치 없음 (허니팟 비활성화)',
    disabledActionShort: '트리거',

    honeypotWarningMessage: '이 채널에 메시지를 보내지 마세요\n\n이 채널은 스팸 봇을 잡기 위해 사용됩니다. 여기서 보낸 메시지는 {{action}}로 이어집니다.',

    dmMessageIntro: '## 허니팟이 발동했습니다\n\n[honeypot]({{link}}) 채널에 메시지를 보내 {{guildName}} 서버에서 **{{actionText}}** 되었습니다.',
    dmMessageFooter: '-# 이는 자동 메시지입니다. 답장은 확인되지 않습니다.',
    dmMessageOwner: '-# 이것은 예시 메시지입니다: 소유자는 {{actionText}}되지 않습니다.'
  }
} as const;

function getTranslations(lang: string) {
  let l = honeypotWarningMessageTranslations[lang];
  if (!l) {
    const _lang = lang.split('-')[0]?.toLocaleLowerCase() || 'en';
    l = honeypotWarningMessageTranslations[_lang];
  }
  if (!l) return honeypotWarningMessageTranslations['en']!;

  const defaultTranslation = honeypotWarningMessageTranslations!['en']!;
  return { ...defaultTranslation, ...l };
}

export function honeypotWarningMessage(
  moderatedCount: number = 0,
  action: 'ban' | 'softban' | 'disabled' = 'softban',
  lang: string = 'en'
): RESTPostAPIChannelMessageJSONBody {
  const translated = getTranslations(lang);

  const actionTextMap = {
    ban: { text: translated.banActionFull, label: translated.banActionShort },
    softban: { text: translated.softbanActionFull, label: translated.softbanActionShort },
    kick: { text: translated.softbanActionFull, label: translated.softbanActionShort },
    disabled: { text: translated.disabledActionFull, label: translated.disabledActionShort }
  };
  const { text: actionText, label: labelText } = actionTextMap[action] || actionTextMap.ban!;

  return {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: {},
    components: [
      {
        type: ComponentType.Container,
        components: [
          {
            type: ComponentType.Section,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: translated.honeypotWarningMessage!.replace("{{action}}", actionText)
              }
            ],
            accessory: {
              type: ComponentType.Thumbnail,
              media: {
                url: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/refs/heads/main/assets/Honey%20pot/3D/honey_pot_3d.png"
              }
            }
          },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                style: ButtonStyle.Secondary,
                label: `${labelText}: ${moderatedCount}`,
                custom_id: "moderated_count_button",
                disabled: true,
                emoji: { name: "🍯" }
              }
            ]
          }
        ],
      },
    ]
  };
}

export function honeypotUserDMMessage(action: 'ban' | 'softban' | 'disabled', guildName: string, link: string, isOwner = false, lang: string = 'en'): RESTPostAPIChannelMessageJSONBody {
  const translated = getTranslations(lang);
  const actionText = {
    ban: translated.bannedActionShort,
    kick: translated.softbannedActionShort,
    softban: translated.softbannedActionShort,
    disabled: translated.disabledActionShort
  }[action] || '???unknown action???';

  return {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: {},
    components: [
      {
        type: ComponentType.Container,
        accent_color: 0xFFD700,
        components: [
          {
            type: ComponentType.Section,
            components: [
              {
                type: ComponentType.TextDisplay,
                content: translated.dmMessageIntro
                  .replace("{{actionText}}", actionText)
                  .replace("{{guildName}}", guildName)
                  .replace("{{link}}", link)
              },
              {
                type: ComponentType.TextDisplay,
                content: translated.dmMessageFooter
              },
            ],
            accessory: {
              type: ComponentType.Thumbnail,
              media: {
                url: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/refs/heads/main/assets/Honey%20pot/3D/honey_pot_3d.png"
              }
            }
          }
        ]
      },
      isOwner ? {
        type: ComponentType.TextDisplay,
        content: translated.dmMessageOwner.replace("{{actionText}}", actionText)
      } : null
    ].filter(Boolean) as any[],
  };
}
