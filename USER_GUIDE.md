# 📱 G-Logic Automation — Beginner's User Guide

Welcome to **G-Logic Automation**, your personal Instagram scheduling command center! This guide will walk you through every feature step by step so you can start planning, scheduling, and optimizing your Instagram content like a pro.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Navigating the App](#2-navigating-the-app)
3. [Using the Content Calendar](#3-using-the-content-calendar)
4. [Scheduling Your First Post](#4-scheduling-your-first-post)
5. [Using Best-Time Suggestions](#5-using-best-time-suggestions)
6. [Tracking Your Posts](#6-tracking-your-posts)
7. [Viewing Performance Analytics](#7-viewing-performance-analytics)
8. [Exploring Resources](#8-exploring-resources)
9. [Using the Automation Power-Up](#9-using-the-automation-power-up)
10. [Mobile Usage Tips](#10-mobile-usage-tips)
11. [Frequently Asked Questions](#11-frequently-asked-questions)

---

## 1. Getting Started

### How to Open G-Logic Automation

1. Open **Terminal** on your Mac (search for "Terminal" in Spotlight with `Cmd + Space`)
2. Type this command and press Enter:
   ```
   cd ~/Desktop/***GramLogic*** && python3 -m http.server 8080
   ```
3. Open your web browser (Chrome, Safari, Firefox, etc.)
4. Go to: **http://localhost:8080**
5. G-Logic Automation will load! 🎉

### How to Stop the App

- Go back to Terminal and press `Ctrl + C` to stop the server.

---

## 2. Navigating the App

G-Logic Automation has **three main pages** accessible from the **sidebar** on the left:

| Icon | Page | What It Does |
|------|------|-------------|
| 📅 | **Calendar** | Your main dashboard — view and schedule posts on a visual calendar |
| 📊 | **Performance** | See engagement stats, charts, and your top-performing posts |
| 📚 | **Resources** | Helpful tools, guides, and recommended services for creators |

### How to Navigate

- **Click any item** in the left sidebar to switch pages.
- The currently active page is highlighted with a pink/purple accent bar.

### On Mobile

- Tap the **☰ hamburger menu** (three lines) in the top-left corner to open the sidebar.
- Tap any menu item to navigate.
- Tap outside the sidebar or press the menu button again to close it.

---

## 3. Using the Content Calendar

The **Calendar** page is your main hub. Here's everything it shows:

### Month View (Default)

- Displays the **entire month** in a grid format (Sunday through Saturday).
- **Today's date** is highlighted with a pink/orange gradient circle.
- **Scheduled posts** appear as small color-coded tags on their dates:
  - 🔵 **Blue** = Scheduled (waiting to be posted)
  - 🟡 **Yellow** = Processing (currently being published)
  - 🟢 **Green** = Published (successfully posted)
  - ⚫ **Gray** = Draft (saved but not scheduled)

### Week View

1. Click the **"Week"** button next to "Month" in the top-right area.
2. The calendar zooms into the **current week** with taller day columns — great for seeing more detail.
3. Click **"Month"** to go back to the full month view.

### Navigating Between Months

- Click the **◀ left arrow** to go to the previous month.
- Click the **▶ right arrow** to go to the next month.
- On mobile, tap **"Today"** in the header to jump back to the current month.

---

## 4. Scheduling Your First Post

This is the most important feature! Here's how to schedule a post step by step:

### Step 1: Open the Scheduler

You have **two ways** to open the scheduling window:

- **Option A:** Click the **"+ New Post"** button (pink gradient button in the top-right corner).
- **Option B:** Click directly on **any date cell** in the calendar — this automatically sets the date for you!

### Step 2: Upload Your Media

1. In the left side of the popup, you'll see a **dashed upload box**.
2. Click on it to select a photo or video from your computer.
3. Or **drag and drop** a file directly onto the box.
4. Supported formats: JPG, PNG, MP4 (up to 50MB).
5. A preview of your media will appear once uploaded.

### Step 3: Write Your Caption

1. Click in the **"Caption"** text area on the right side.
2. Write your Instagram caption.
3. Use emojis, line breaks, and calls-to-action to make it engaging!
4. The **character counter** at the bottom right shows how many characters you've used out of 2,200 (Instagram's limit).

### Step 4: Set the Date and Time

1. The **Date** field will be pre-filled if you clicked on a calendar date.
2. Click the **Time** field to set the exact posting time.
3. 💡 **Pro tip:** Click one of the **"Suggested Times"** chips below the upload area to auto-fill a high-engagement time!

### Step 5: Add Hashtags

1. Click the **"Hashtags"** field.
2. Type your hashtags separated by spaces (e.g., `#photography #instagood #content`).

### Step 6: Choose Post Type

Select the **type of content** you're posting:
- **Image** — A single photo post
- **Reel** — A short-form video
- **Carousel** — Multiple images/videos in a swipeable post

### Step 7: Schedule or Save

- Click **"Schedule Post"** (pink button) to add it to your calendar.
- Click **"Save Draft"** (gray button) to save it without scheduling.
- You'll see a ✅ success notification at the bottom of the screen!

### Step 8: Verify on the Calendar

- Your new post will instantly appear on the calendar on the date you selected.
- It will show as a 🔵 blue "Scheduled" tag.

---

## 5. Using Best-Time Suggestions

G-Logic Automation analyzes simulated audience behavior to suggest the **top 3 best posting times**.

### On the Dashboard (Right Side Widget)

1. Look for the **"Best Times to Post"** card on the right side of the Calendar page.
2. You'll see three ranked suggestions:
   - **#1** — 9:00 AM on Weekdays (+34% engagement)
   - **#2** — 12:30 PM on Tue & Thu (+28% engagement)
   - **#3** — 7:00 PM on Mon–Fri (+22% engagement)
3. **Click any suggestion** to open the scheduler with that time pre-filled!

### Inside the Scheduler Modal

- When the scheduling popup is open, you'll see **"Suggested Times"** chips below the media upload area.
- Click any chip (e.g., `9:00 AM · +34%`) to automatically set the time picker to that value.

---

## 6. Tracking Your Posts

### Upcoming Posts Widget

On the Calendar page, below the Best Times widget, you'll find **"Upcoming Posts"**:

- Shows your next 5 non-published posts in chronological order.
- Each post displays: caption preview, date, time, and current **status badge**.

### Auto-Post Simulation

When you schedule a post, G-Logic Automation simulates the publishing process:

1. **Scheduled** (Blue) — Post is queued and waiting.
2. **Processing** (Yellow) — After ~5 seconds, the post enters "processing" mode.
3. **Published** (Green) — After ~10 seconds, the post is "published" with a celebration notification! 🎉

> **Note:** This is a simulation to demonstrate how the feature works. The status colors update automatically on both the calendar and the Upcoming Posts widget in real time.

---

## 7. Viewing Performance Analytics

Click **"Performance"** in the sidebar to see your engagement data.

### Stat Cards (Top Row)

| Metric | Description |
|--------|-------------|
| **Total Reach** | How many unique accounts have seen your content |
| **Engagement Rate** | Percentage of followers who interact with your posts |
| **Followers** | Your total follower count and recent growth |
| **Posts This Month** | Number of posts published this month |

Each card shows a **trend indicator** (green = positive growth).

### Weekly Engagement Chart

- A visual line chart showing **Likes** (pink), **Comments** (purple), and **Saves** (orange) across the week.
- Helps you identify which days get the most engagement.

### Top Performing Posts

- A ranked list of your best posts with detailed stats:
  - **Likes** — Number of heart reactions
  - **Comments** — Number of comments
  - **Saves** — Number of times users saved your post (a key metric for the algorithm!)

---

## 8. Exploring Resources

Click **"Resources"** in the sidebar to access creator tools and guides.

There are **6 resource cards** available:

| # | Resource | Description |
|---|----------|-------------|
| 1 | **ManyChat Automation** | Automate Instagram DMs, stories, and comment replies |
| 2 | **Hashtag Strategy Guide** | Learn how to research and use hashtags effectively |
| 3 | **Reels Best Practices** | Maximize Reels performance with proven strategies |
| 4 | **Caption Writing Templates** | Copy-and-paste caption frameworks |
| 5 | **Posting Schedule Blueprint** | A proven weekly schedule for consistency |
| 6 | **Analytics Mastery** | Understand Instagram Insights for growth |

Each card has a clickable link at the bottom. Click the link to visit the resource.

> **For site owners:** All 6 resource cards can be customized with your own affiliate links! See the "Customization" section below.

---

## 9. Using the Automation Power-Up

In the **bottom of the sidebar**, you'll see the **"Automation Power-Up"** button:

- This links to **ManyChat**, a popular Instagram automation tool.
- Click it to open ManyChat in a new tab.
- ManyChat helps you automate DMs, create auto-replies to comments, and build chat flows.

---

## 10. Mobile Usage Tips

G-Logic Automation is designed to work great on phones and tablets! Here are some tips:

1. **Open the sidebar:** Tap the ☰ menu icon in the top-left corner.
2. **Close the sidebar:** Tap outside the sidebar or tap the ☰ icon again.
3. **Jump to today:** Tap the **"Today"** button in the top-right of the mobile header.
4. **Schedule a post:** Tap any date on the calendar to open the scheduler.
5. **Upload media:** The drag-and-drop zone works with your phone's camera roll — tap it to select a photo.
6. **Scroll the calendar:** On smaller screens, swipe left/right to see all days.

---

## 11. Frequently Asked Questions

### Q: Does G-Logic Automation actually post to Instagram?
**A:** No. G-Logic Automation is a planning and scheduling tool. The "auto-post simulation" is a demonstration of how a publishing workflow works. To actually post, use the scheduled content as your guide or connect it with automation tools like ManyChat.

### Q: Can I edit a post after scheduling it?
**A:** Currently, posts are added to the calendar after scheduling. In a future update, clicking on a scheduled post will allow editing.

### Q: How do I delete a post?
**A:** This feature is coming in a future update. For now, draft posts and scheduled posts will remain on the calendar.

### Q: Is my data saved?
**A:** Data is stored in your browser session. If you refresh the page, the sample posts will reload. For persistent storage, a database backend would need to be added.

### Q: Can I change the colors or design?
**A:** Yes! Open the `index.css` file and modify the CSS custom properties (variables) at the top of the file under `:root { }`. You can change colors, fonts, spacing, and more.

### Q: How do I add my own affiliate links to the Resources page?
**A:** Open the `index.html` file and find the `resource-card` sections. Change the `href="#"` in each `<a>` tag to your affiliate URL. See the customization guide below.

---

## Customizing Resource Card Links

To change any resource card link to your own affiliate URL:

1. Open `index.html` in any text editor.
2. Search for `resource-card` to find the 6 cards.
3. For each card, find the `<a href="#"` link at the bottom.
4. Replace `#` with your affiliate URL.

**Example — changing the Hashtag Strategy card:**

Before:
```html
<a href="#" class="resource-link">Read Guide →</a>
```

After:
```html
<a href="https://your-affiliate-link.com" target="_blank" rel="noopener noreferrer" class="resource-link">Read Guide →</a>
```

Make sure to include `target="_blank"` so the link opens in a new tab, and `rel="noopener noreferrer"` for security.

---

## Need Help?

If you run into any issues:
- Make sure the Terminal is still running the server command.
- Try refreshing the page with `Cmd + Shift + R` (hard refresh).
- Check that you're visiting `http://localhost:8080`.

Happy creating! 🎨📸✨
