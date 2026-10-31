# CODE-ROYALE LOCAL — Clean LAN Build

A small, dependency-free Node.js quiz game. One Windows laptop runs the server and Admin page. Two other laptops join from a browser using the host laptop's local Wi-Fi / Windows Mobile Hotspot address. No cloud, paid hosting, internet, database service, or npm package install is needed.

## Host laptop requirements
- Windows 10/11
- Node.js 18+ (LTS recommended)
- The project folder extracted locally

## First run in VS Code
1. Extract this ZIP.
2. Open the extracted `CODE-ROYALE-REBUILT` folder in VS Code (`File > Open Folder`).
3. Open `Terminal > New Terminal`.
4. Run `node -v` to confirm Node.js is installed.
5. Run `npm start` (or double-click `START-GAME.bat`).
6. Keep the terminal open while playing.
7. Open Admin on the host laptop: `http://localhost:3000/admin`.

No `npm install` is required. This project uses only Node.js built-in modules.

## Connect the two player laptops without internet
1. On the host laptop, turn ON Windows Mobile Hotspot: `Settings > Network & Internet > Mobile hotspot`.
2. Set a simple hotspot name/password. Connect Player Laptop 1 and Player Laptop 2 to this hotspot.
3. With the hotspot ON, open Command Prompt on the host and run `ipconfig`.
4. Find the IPv4 address belonging to the hotspot adapter. On many Windows systems this adapter is named `Local Area Connection* <number>` and its address is often `192.168.137.1`. Do not assume this; use the address actually shown by `ipconfig`.
5. On the host laptop, right-click `ALLOW-FIREWALL.bat` and choose **Run as administrator** once. It allows only local-subnet devices to connect to TCP port 3000.
6. On the other laptops, open a browser and first test: `http://HOST-IP:3000/health`. It must show JSON containing `"ok":true`.
7. If the health test works, open:
   - Player 1: `http://HOST-IP:3000/player/1`
   - Player 2: `http://HOST-IP:3000/player/2`
   Replace `HOST-IP` with the IPv4 address of the host's hotspot adapter.

## If it still says "took too long to respond"
- Confirm both player laptops show the host hotspot name as connected.
- Check the host IP again with `ipconfig` AFTER turning the hotspot on. The IP can change when the hotspot is restarted.
- Use the hotspot adapter's IPv4 address, not a VPN, Ethernet, or unrelated Wi-Fi adapter address.
- Check that `http://localhost:3000/health` works on the host first.
- On the host, run `Test-NetConnection 127.0.0.1 -Port 3000` in PowerShell. It should show `TcpTestSucceeded : True`.
- On a player laptop, run `Test-NetConnection HOST-IP -Port 3000`. If False, it is still a Windows hotspot/firewall/network isolation issue, not a game-page issue.
- Some corporate/school Wi-Fi or managed devices block client-to-host traffic. Use the Windows hotspot from the host laptop instead.
- Do not use `localhost` on player laptops. Their `localhost` means their own laptop.

## Game flow
1. Players enter names and JOIN.
2. Both press READY.
3. Admin chooses DSA / Python / HTML-CSS / Mixed and Easy / Medium / Hard / All.
4. Admin starts a match. Exactly 5 preloaded questions are selected.
5. Both players see the same question and 5-second countdown. Each has 20 seconds to answer; if both answer sooner, the round moves to reveal.
6. Correct answer = 10 points. Wrong or unanswered = 0. The correct answer and explanation are revealed after each question.
7. Highest score wins. Tie-break: lower total time on correct answers. If still tied, DRAW.
8. Admin sees player names, statuses, scores and question progress, not the selected answer choices. At match end, Admin shows Winner / Draw.

## Question bank and sounds
- `data/questions.json`: 150 preloaded questions (100 DSA, 30 Python, 20 HTML/CSS), with four options, answer key and explanation.
- Questions and answer keys are local. The answer key is not sent to players while the question is live.
- `public/sounds/`: separate MP3 sound effects. Replace an MP3 with your own audio but keep the same filename.
- `data/leaderboard.json`: top 15 player results saved on the host laptop.

## Network facts
- Admin: host laptop only, `localhost:3000/admin`.
- Players: use the host laptop's hotspot IPv4 address and port `3000`.
- Only the host needs Node.js and this project. Player laptops need only a browser.
- The host laptop must remain awake, hotspot ON, and Node server running.
