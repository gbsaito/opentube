# plan
terminal user interface (TUI) to browse youtube.
# stack
opentui + bun + typescript

# features
1. search youtube videos through frontends (yt-dlp, invidious or piped → can be selected from the terminal)
2. shows a list of video “titles” and a sidebar with video thumbnail, Title, date, channel, description (short)
	- enter → opens mpv in best audio+video mode
	- p → plays in audio mode only
	- esc returns to homescreen 
3. quick acess: history, playlists, (local) subscriptions, settings
4. optional auth

NOTES: 
- settings must live inside .config in a .conf
- homescreen must be inspired by the opencode’s design (below is in vertical order)
	- opentube (pixel font, but without shadows)
	- search box: solid background, left border, text placeholder
	- quick acess
- search bar is automatically focused (esc to focus quick acess and / to go back)
# implementation order
ask user feedback after finishing the set of features
- 1-3 → 3 (visual only)
- 4 (planned)