# STQC Alarm 🚨

Alarmy jednostki OSP na telefonie: **✅ Jadę · ⏱ 5 min · ⏱ 10 min · ❌ Nie jadę** i wspólna lista „kto jedzie” —
na iPhonie i na Androidzie, w jednej zbiórce.

**Aplikacja:** https://dolegaj.github.io/stqc-alarm/

## iPhone (iOS 16.4 lub nowszy)

1. Otwórz link powyżej w **Safari** (albo zeskanuj kod QR z programu STQC Decoder aparatem iPhone'a).
2. **Udostępnij** → **„Do ekranu początkowego”** → **Dodaj**.
3. Uruchom **STQC Alarm** z ekranu początkowego, wpisz **kod drużyny** i swoje imię.
4. Stuknij **Włącz powiadomienia** → **Pozwalaj**.
5. *Ustawienia → Skupienie → Nie przeszkadzać → Aplikacje* → dodaj **STQC Alarm**.

## Android

Pobierz **[STQC-Alarm.apk](https://dolegaj.github.io/stqc-alarm/STQC-Alarm.apk)** i zainstaluj (Android 8+).
Na Androidzie alarm dzwoni jak budzik — na pełnym ekranie, także przy wyciszonym telefonie.

## Karta zdarzenia i nawigacja

Gdy po alarmie stanowisko poda przez radio miejsce i rodzaj zdarzenia, dekoder (AI z korespondencji) dosyła
kartę: **🔥 rodzaj · 📍 adres · NAWIGUJ** (Google Maps / Mapy Apple / Waze). To wynik AI — może się mylić,
dlatego karta pokazuje też cytat z korespondencji.

**Aktualizacja na Androidzie:** pobierz nowy plik APK i zainstaluj na starej aplikacji — kod drużyny i historia zostają.

## Jak to działa

Alarmy wysyła program **STQC Decoder** na komputerze z radiem. Wiadomości idą przez serwer ntfy.sh
zaszyfrowane AES-256-GCM kluczem z kodu drużyny — bez kodu nikt ich nie odczyta. Powiadomienia na iPhone'a
dekoder wysyła standardem Web Push (szyfrowanie kluczem telefonu). Ta strona nie zbiera żadnych danych:
kod drużyny i historia alarmów są zapisane tylko na telefonie.
