# Player avatars

Drop face images in here. Anything named `1.png`, `2.png`, `3.webp` ... is picked
up automatically on server start: the filename stem must be a number, and that
number is the avatar slot a player gets assigned.

Supported: `.svg`, `.png`, `.webp`, `.jpg`.

```
public/avatars/1.png
public/avatars/2.png
public/avatars/3.png
```

Nothing is generated. Until you add files here, players fall back to a monogram
tile: their initial on a colour derived from their name, which is stable and
unique-looking without pretending to be a face.

Slots are handed out round-robin by name hash, so the same player keeps the same
face on every device, and adding more files simply widens the pool.
