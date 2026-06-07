# Dropbox Image Uploader
An obsidian plugin that uplaods new images imported to the note to dropbox.

When you add an image to a note, this plugin will uploads it to a dedicated folder in dropbox, and then removes the local copy of image (in obsidian inamge folder, not the original one). This reduces the size of the vault, and results in less data usage for syncing between devices.

## How to use
1. Download the latest release (**Source code**).
2. Unzip the downloaded file. It will give you a folder named Dropbox-Image-Uploader-1.#.#
3. Copy the folder and paste it in your obsidian plugin directory.
4. Open Obsidian. Go to **Settings → Community Plugins** and make sure **Restricted Mode is off**.
5. Under **Installed Plugins**, click the refresh icon, then find **Dropbox Image Uploader** and toggle it on.
6. Go to **Settings → Dropbox Image Uploader** and paste your Dropbox Access Token.

## How to get dropbox access token
Login to your dropbox account and go to this [link](https://www.dropbox.com/developers/apps). Create app and then in the settings page of your app there is a **Generated access token** section. Click on **Generate** and copy the access token it gives. Now you can use the token in obsidian plugin setting.
