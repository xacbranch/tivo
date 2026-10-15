"""The channel lineup: what airs on every channel, and when.

Edit this file, then rebuild the lineup:   python3 tools/build_lineup.py
Nothing here needs a media library: every channel streams, from free live services,
archive.org or the National Weather Service. (A channel can also play your own videos
from a folder; see folder() below.)

Channel kinds:
  CHANNELS       scheduled channels: pools of programs, and dayparts saying which pool airs when
  IPTV           live streams (HLS links, or Pluto TV channels)
  RADIO          internet radio, shown with a station card
  WEATHER        a WeatherStar-style local forecast (National Weather Service: US only)
  GOLF_WEATHER   golf weather for a city's courses, with hole flyovers

Pool kinds (for CHANNELS):
  archive(collection, ...)   a series on archive.org: one item per episode, in air-date order
  again(pool)                the episode another pool aired last (same-day repeats)
  archive_list(...)          standalone archive.org videos, each its own program
  tapes(*keys)               off-air recordings from TAPES, aired straight through
  folder(path)               every video in a folder of your own (under MEDIA_ROOT)
  rotate(a, b, ...)          alternate between pools, one program each
  daily(a, b, ...)           one pool per day, cycling

Daypart fields: at (HH:MM, the box's local time), pool, hard (start exactly on time),
days (0=Sun..6=Sat). Programs start on the hour or half hour; the gap after one is the
commercial break (or, with ads=None, an "up next" card).
"""


def rotate(*pools):
    return {'kind': 'rotate', 'pools': list(pools)}


def daily(*pools):
    return {'kind': 'daily', 'pools': list(pools)}


def dp(at, pool, hard=False, days=None):
    d = {'at': at, 'pool': pool}
    if hard:
        d['hard'] = True
    if days is not None:
        d['days'] = days
    return d


def archive(collection, show, year, genres, blurb, longest=None, order='sequential'):
    """A series streamed from an archive.org collection (one item per episode, in air-date
    order), never downloaded. longest: leave out episodes over this many minutes (the hour
    specials that wouldn't fit a regular slot)."""
    return {'kind': 'archive', 'collection': collection, 'show': show, 'year': year, 'genres': genres,
            'blurb': blurb, 'longest': longest, 'order': order}


def again(pool):
    """The episode a pool aired last, again: a network's same-day repeats."""
    return {'kind': 'again', 'pool': pool}


def archive_tapes(*items):
    """Off-air recordings streamed from archive.org, aired straight through in order and
    listed in half-hour parts. items: (identifier, guide title, description)."""
    return {'kind': 'archive_tapes', 'items': [dict(id=i, t=t, s=s) for i, t, s in items]}


def archive_list(*items, genres, order='shuffle'):
    """Videos streamed from archive.org, each its own program. items: (identifier, title,
    year or None, description or '' for archive.org's own)."""
    return {'kind': 'archive_list', 'items': [dict(id=i, t=t, y=y, s=s) for i, t, y, s in items],
            'genres': genres, 'order': order}


def tapes(*keys, fallback=None):
    """Recordings from TAPES, in order. fallback: a pool to air if none of them are available."""
    return {'kind': 'tapes', 'tapes': list(keys), 'fallback': fallback}


def folder(path, show=None, genres=('Comedy',), order='sequential'):
    """Every video in a folder under MEDIA_ROOT (sorted by name, subfolders included), as
    episodes of one show (show: its name; default the folder's)."""
    return {'kind': 'folder', 'path': path, 'show': show, 'genres': list(genres), 'order': order}


WEEKDAYS = [1, 2, 3, 4, 5]


# ── scheduled channels ────────────────────────────────────────────────────────
CHANNELS = [
    dict(num='296', call='CN', name='Cartoon Network', logo='CN.png', ads=None,
         tagline='Cartoons all day, Toonami at 5, [adult swim] at 11.', pools={
        'cn': tapes('cn98', 'ppg', 'scoob', 'cn02', 'rabbit', 'cn03'),
        'toonami': tapes('tn99', 'dbz244', 'tn02', 'kwb', 'run', fallback='cn'),
        'swim': tapes('as02', 'as04', 'as04a', 'as05', 'as05b', 'as07', fallback='cn'),
    }, dayparts=[
        dp('06:00', 'cn'),
        dp('17:00', 'toonami', hard=True, days=WEEKDAYS), dp('19:00', 'cn', days=WEEKDAYS),
        dp('19:00', 'toonami', hard=True, days=[6]),
        dp('23:00', 'swim', hard=True), dp('03:00', 'cn'),
    ]),
    dict(num='299', call='NICK', name='Nickelodeon', logo='NICK.png', ads=None,
         tagline='Nicktoons all day, TEENick on Sunday night, SNICK on Saturday.', pools={
        'nick': tapes('nk00', 'nk01a', 'nk01b', 'nk01c', 'nk01d', 'nk02a', 'nk02b', 'nk03'),
        'snick': tapes('snk98', 'snk02', fallback='nick'),
        'teennick': tapes('teen01', fallback='nick'),
    }, dayparts=[
        dp('06:00', 'nick'),
        dp('18:00', 'teennick', hard=True, days=[0]), dp('21:00', 'nick', days=[0]),
        dp('20:00', 'snick', hard=True, days=[6]), dp('22:00', 'nick', days=[6]),
    ]),
    # G4's own two shows, streamed from archive.org (2008-2013 episodes). G4 was one national
    # feed, so its Eastern grid (g4tv.com/schedule, spring 2008) airs two hours earlier here:
    # Attack of the Show! live at 7 pm Eastern is 5 pm Mountain, X-Play after it, and the
    # night's episodes repeat that night and the next morning and afternoon. G4 filled the
    # rest with Cops and Cheaters; this G4 fills it with more X-Play and AOTS.
    dict(num='354', call='G4', name='G4', logo='G4.svg', ads=None,
         tagline='Videogame TV: Attack of the Show! live at 5, X-Play at 6.', pools={
        'aots': archive('attackoftheshow', 'Attack of the Show!', 2005, ['Talk', 'Technology', 'Comedy'],
                        "G4's live nightly look at gadgets, games, the web and pop culture.", longest=60),
        'xplay': archive('g4-xplay', 'X-Play', 2003, ['Technology', 'Comedy'],
                         'Adam Sessler and Morgan Webb review the latest videogames.', longest=30),
        'aots_again': again('aots'),
        'xplay_again': again('xplay'),
        'aots_vault': archive('attackoftheshow', 'Attack of the Show!', 2005, ['Talk', 'Technology', 'Comedy'],
                              "G4's live nightly look at gadgets, games, the web and pop culture.", order='shuffle'),
        'xplay_vault': archive('g4-xplay', 'X-Play', 2003, ['Technology', 'Comedy'],
                               'Adam Sessler and Morgan Webb review the latest videogames.', order='shuffle'),
        'vault': rotate('xplay_vault', 'aots_vault'),
    }, dayparts=[
        # weekdays: last night's episodes in the morning and at lunch
        dp('07:00', 'aots_again', hard=True, days=WEEKDAYS), dp('08:00', 'xplay_again', hard=True, days=WEEKDAYS),
        dp('08:30', 'vault', days=WEEKDAYS),
        dp('11:00', 'aots_again', hard=True, days=WEEKDAYS), dp('12:00', 'xplay_again', hard=True, days=WEEKDAYS),
        dp('12:30', 'vault', days=WEEKDAYS),
        # the new ones, then the night's repeats
        dp('17:00', 'aots', hard=True, days=WEEKDAYS), dp('18:00', 'xplay', hard=True, days=WEEKDAYS),
        dp('18:30', 'vault', days=WEEKDAYS),
        dp('20:00', 'aots_again', hard=True, days=WEEKDAYS), dp('21:00', 'vault', days=WEEKDAYS),
        dp('23:00', 'xplay_again', hard=True, days=WEEKDAYS), dp('23:30', 'vault', days=WEEKDAYS),
        dp('01:30', 'aots_again', hard=True, days=[2, 3, 4, 5, 6]), dp('02:30', 'xplay_again', hard=True, days=[2, 3, 4, 5, 6]),
        dp('03:00', 'vault', days=[2, 3, 4, 5, 6]),
        # weekends: repeats, an AOTS marathon late Saturday, an X-Play marathon late Sunday
        dp('06:00', 'vault', days=[0, 6]),
        dp('21:00', 'aots_vault', hard=True, days=[6]), dp('01:00', 'vault', days=[0]),
        dp('22:00', 'xplay_vault', hard=True, days=[0]), dp('00:30', 'vault', days=[1]),
    ]),
    # The Golf Channel, from archive.org, on 9 next to the golf weather on 8 (DirecTV had it on
    # 605): the network's own shows as
    # taped off the air in 2001-2005 (commercials already cut), with the instruction tapes and
    # golf comedies of the VHS shelf around them. No tournament coverage, and the box adds no
    # commercials; the gaps between programs get the up-next card.
    dict(num='9', call='GOLF', name='The Golf Channel', logo='GOLF.png', ads=None,
         tagline='Golf Channel Academy, lessons from the pros, and the golf video shelf.', pools={
        'gctv': archive_tapes(
            ('mid2001golfchannelshows', 'The Golf Channel Academy',
             'Mid-2001 on The Golf Channel: The Golf Channel Academy and Bobby Jones "Lessons From a Legend."'),
            ('early2003golfchannelshows', 'Golf Channel Academy Live',
             'Early 2003: Golf Channel Academy Live and Playing Lessons From the Pros.'),
            ('2003golfchannelshows', 'Golf Channel Academy Live', 'Golf Channel Academy Live, 2003.'),
            ('early2004golfchannelshows', 'Your Game Night',
             "Early 2004: Your Game Night, Golf Fitness Academy, Champions Tour Learning Center and What's in the Bag."),
            ('2004golfchannelshows', 'Golf Channel Academy Live',
             "Mid-2004: Academy Live, Your Game Night, What's in the Bag and Champions Tour Learning Center."),
            ('2004golfchannelshows2', 'Your Game Night',
             "Late 2004: Your Game Night, Academy Live, Champions Tour Learning Center and What's in the Bag."),
            ('october2004golfchannelshows', 'Golf Channel Academy Live',
             'October 2004: Academy Live, Your Game Night, Champions Tour Learning Center and Bobby Jones "Lessons From a Legend."'),
            ('late2004golfchannelshows', 'Lessons From a Legend',
             'Late 2004: Bobby Jones "Lessons From a Legend," Academy Live and Your Game Night.'),
            ('mid2005golfchannelshows', 'Golf Fitness Academy',
             "Summer 2005: Golf Fitness Academy, Your Game Night, Lessons From the Pros, Champions Tour Learning Center, "
             "What's in the Bag and Golf Central."),
            ('august2005golfchannelshows', 'Your Game Night',
             "August 2005: Your Game Night, Golf Fitness Academy, Academy Live, Playing Lessons From the Pros and What's in the Bag."),
            ('december2005golfchannelshows', 'Grand Slam Champions Clinic',
             'December 2005: the Grand Slam Champions Clinic, Academy Live and Your Game Night.'),
        ),
        'lessons': archive_list(
            ('golfdigest-cureyourslicenow', 'Golf Digest: Cure Your Slice Now', 2000, "Golf Digest's teachers straighten out the slice."),
            ('aj-reveals-the-truth-about-golf-part-3-the-search-for-the-truth-2002',
             'AJ Reveals the Truth About Golf, Part 1', 2002, 'Part one of the swing course: the search for the truth.'),
            ('aj-reveals-the-truth-about-golf-part-3-the-discovery-of-the-truth-2002',
             'AJ Reveals the Truth About Golf, Part 2', 2002, 'Part two: the discovery of the truth.'),
            ('aj-reveals-the-truth-about-golf-part-3-the-application-of-the-truth-2002',
             'AJ Reveals the Truth About Golf, Part 3', 2002, 'Part three: putting the truth to work on the course.'),
            ('aj-reveals-the-truth-about-golf-the-truth-about-the-short-game-2002',
             'AJ Reveals the Truth About the Short Game', 2002, 'Chipping, pitching and putting, the AJ way.'),
            ('golf-my-way', 'Jack Nicklaus: Golf My Way', 1983, "Jack Nicklaus's classic lesson, from the grip to the long game."),
            ('jack-nicklaus-playing-the-game-volume-2-1990-uk-vhs', 'Jack Nicklaus: Playing the Game, Volume 2', 1990,
             'Nicklaus on playing the course, shot by shot.'),
            ('libertymutuals18tipsfrom18legendsofgolf', '18 Tips From 18 Legends of Golf', None,
             "Liberty Mutual's Legends of Golf each share the tip that served them best."),
            ('KissGolf', "Danny McMaster's Kiss Golf", None, 'Keep it simple: a plain-spoken swing lesson.'),
            ('GregNormanGolf', 'Greg Norman Golf', None, 'The Shark teaches his game.'),
            ('vintage-vhs-greg-norman---golf-one-on-one-the-basic-fundamentals', 'Greg Norman: Golf One on One', None,
             'Grip, stance and the basic swing, one on one with Greg Norman.'),
            ('vintage-vhs-arnold-palmer-mastering-the-fundamentals-play-great-golf', 'Arnold Palmer: Mastering the Fundamentals', None,
             "Arnie's fundamentals for playing great golf."),
            ('vintage-vhs-johnny-millers-golf-clinic-fixing-your-swing', "Johnny Miller's Golf Clinic: Fixing Your Swing", None,
             'Johnny Miller diagnoses and fixes the common swing faults.'),
            ('vintage-vhs-golf-digest-8-ways-to-a-better-golf-game', 'Golf Digest: 8 Ways to a Better Golf Game', None,
             "Eight fixes from Golf Digest's teaching panel."),
            ('vintage-vhs-golf-digest-how-to-get-distance--accuracy', 'Golf Digest: How to Get Distance & Accuracy', None,
             'Longer and straighter, from Golf Digest.'),
            ('vintage-vhs-harvey-penicks-little-red-video-lessons-and-teachings-from-a-lifetime-in-golf', "Harvey Penick's Little Red Video",
             None, 'Lessons and teachings from a lifetime in golf.'),
            ('vintage-vhs-harvey-penicks-little-green-video-harvey-penicks-private-golf-lessons', "Harvey Penick's Little Green Video",
             None, "Harvey Penick's private golf lessons."),
            ('vintage-vhs-golfs-most-common-faults-and-cures-with-jim-flick', "Golf's Most Common Faults and Cures", None,
             'Jim Flick on the faults he sees most, and the cures.'),
            ('vintage-vhs-wally-armstrongs-golf-the-easy-way-short-game-drills', "Wally Armstrong's Golf the Easy Way: Short Game Drills",
             None, 'Drills for chipping, pitching and putting.'),
            ('vintage-vhs-feel-your-way-to-better-golf-with-wally-armstrong', 'Feel Your Way to Better Golf', None,
             'Wally Armstrong teaches the swing by feel.'),
            ('vintage-vhs-phil-ritson-video-encyclopedia-of-golf-grip-posture-aim-and-stance', 'Phil Ritson Video Encyclopedia of Golf',
             None, 'Grip, posture, aim and stance.'),
            ('vintage-vhs-golf-for-women', 'Golf for Women', None, 'Instruction for women golfers.'),
            ('vintage-vhs-the-golf-university-short-game', 'The Golf University: Short Game', None, 'A full course on the short game.'),
            ('vintage-vhs-graduate-to-better-golf-with-ken-blanchard--kip-puterbaugh', 'Graduate to Better Golf', None,
             "Ken Blanchard and Kip Puterbaugh's golf school, on tape."),
            ('vintage-vhs-john-darlings-inside-power-path-golf', "John Darling's Inside Power Path", None, 'A swing system for power.'),
            ('vintage-vhs-buddy-sheltons-common-mistakes-by-the-uncommon-golfer', 'Common Mistakes by the (Un)Common Golfer', None,
             "Buddy Shelton on the mistakes everybody makes."),
            ('vintage-vhs-short-game-scoring-secrets-with-the-super-swing-technique', 'Short Game Scoring Secrets', None,
             'Scoring shots with the Super Swing technique.'),
            ('vintage-vhs-super-swing-plus-by-pga-professional-jerry-heard', 'Super Swing Plus', None, "PGA pro Jerry Heard's Super Swing."),
            ('vintage-vhs-gregg-mchattons-distance--maximum-power', "Gregg McHatton's Distance & Maximum Power", None,
             'Long-drive secrets for more distance.'),
            ('vintage-vhs-the-greater-golfer-in-you-volume-2', 'The Greater Golfer in You, Volume 2', None, 'Volume two of the lesson series.'),
            ('a-lesson-with-ledbetter-the-short-game-1991-golf-instructional-vhs', 'A Lesson With Leadbetter: The Short Game', 1991,
             "David Leadbetter's short-game lesson."),
            ('improve-your-golf-master-class-1991-uk-vhs', 'Improve Your Golf: Master Class', 1991, 'A master class from the Improve Your Golf series.'),
            ('improve-your-golf-brush-up-your-basics-1991-uk-vhs', 'Improve Your Golf: Brush Up Your Basics', 1991, 'Back to basics.'),
            ('montys-stroke-savers-1997-uk-vhs', "Monty's Stroke Savers", 1997, "Colin Montgomerie's tips for lower scores."),
            ('15-shots-to-save-your-golf-game-1995-golf-digest-vhs', 'Golf Digest: 15 Shots to Save Your Golf Game', 1995,
             'Fifteen shots every golfer needs.'),
            ('the-longest-drive-impact-solutions', 'The Longest Drive', None, 'Long-drive secrets from Impact Solutions.'),
            genres=['Instructional', 'Golf']),
        'features': archive_list(
            ('leslie-nielsens-bad-golf-my-way-1994-uk-vhs', "Leslie Nielsen's Bad Golf My Way", 1994, 'Leslie Nielsen shows how not to play golf.'),
            ('leslie-nielsens-stupid-little-golf-video-1998-uk-vhs', "Leslie Nielsen's Stupid Little Golf Video", 1998, 'More bad golf, Nielsen-style.'),
            ('vintage-vhs-rodney-dangerfields-guide-to-golf-style--etiquette', "Rodney Dangerfield's Guide to Golf", None,
             'Style and etiquette, Rodney\'s way.'),
            ('golf-gone-crazy', 'Golf Gone Crazy', None, "Golf's oddest moments, trick shots and bloopers."),
            ('mygreatestgolfshot', 'My Greatest Golf Shot', None, "Golf's greats remember the shots they'll never forget."),
            ('dorfs-golf-bible', "Dorf's Golf Bible", 1988, "Tim Conway's Dorf on the rules of golf."),
            ('the-stars-greatest-golf-jokes-1992-uk-vhs', "The Stars' Greatest Golf Jokes", 1992, 'Celebrities tell their favorite golf jokes.'),
            ('vintage-vhs-the-amazing-joey-o-golf-entertainment', 'The Amazing Joey "O"', None, "A trick-shot artist's golf show."),
            ('vintage-vhs-the-wide-world-of-golf-video-magazine-1990-march--april', 'The Wide World of Golf Video Magazine', 1990,
             'The March/April 1990 issue.'),
            ('vintage-vhs-the-wide-world-of-golf-video-magazine-1990-may--june', 'The Wide World of Golf Video Magazine', 1990,
             'The May/June 1990 issue.'),
            ('uncommon-ephemera-vhs-V6', 'Golf in America', None,
             'The Golf Channel looks back at the 1991 Ryder Cup at Kiawah Island (the tape ends early).'),
            ('the-tiger-woods-story_1998', 'The Tiger Woods Story', 1998, "Showtime's 1998 movie about Tiger Woods's rise."),
            genres=['Golf', 'Comedy']),
    }, dayparts=[
        # weekday mornings and middays with the network's own shows; weekend mornings are lessons
        dp('06:00', 'gctv', days=WEEKDAYS), dp('06:00', 'lessons', days=[0, 6]),
        dp('09:00', 'lessons', days=WEEKDAYS),
        dp('12:00', 'gctv', hard=True), dp('15:00', 'lessons'),
        # prime time: Academy Live and Your Game Night, then the comedies and features
        dp('18:00', 'gctv', hard=True), dp('21:00', 'features', hard=True),
        dp('23:00', 'gctv'), dp('02:00', 'lessons'),
    ]),
    # Your own videos, if you have some: put them under MEDIA_ROOT (default ./media) and
    # give them a channel, e.g.
    # dict(num='500', call='MINE', name='My Channel', tagline='Home movies.', ads=None,
    #      pools={'all': folder('Home Movies', show='Home Movies')}, dayparts=[dp('06:00', 'all')]),
]


# Off-air VHS recordings on archive.org, streamed as they play: (identifier, guide title,
# description[, a word every file to air must contain]). Each airs straight through, listed
# in half-hour parts, with the commercials it was taped with. Items do get taken down; the
# build skips any that are gone (six of the originals went dark in October 2026).
TAPES = {
    # Cartoon Network, daytime
    'cn98': ('pink-panther-november-1998', 'Cartoon Network: November 1998', 'The Pink Panther and friends, with the commercials as they aired.'),
    'ppg': ('ppg-vhs', 'The Powerpuff Girls', 'A 1998 Powerpuff Girls taping, ads and all.'),
    'scoob': ('blank-vhs-scoob-witchs-ghost', "Scooby-Doo and the Witch's Ghost", 'The Cartoon Network broadcast, with commercials.', "Witch's Ghost"),
    'cn02': ('CartoonNetworkAndNickelodeonVHS2002', 'Cartoon Network: 2002', 'Afternoon cartoons from 2002.'),
    'cn03': ('cartoon-network-tape-1', 'Cartoon Network: 2003', 'Cartoons and commercials from 2003.'),
    'rabbit': ('vts-01-1_20210131', 'Who Framed Roger Rabbit', 'The Cartoon Network broadcast, mostly complete.', 'VTS_01'),
    # Toonami
    'tn99': ('toonami1999', 'Toonami', 'TOM hosts the afternoon block, 1999.'),
    'tn02': ('ToonamiNovember2002', 'Toonami', 'Toonami from November 2002.'),
    'kwb': ('KWB08162001', "Kids' WB Toonami", 'Thursday, August 16, 2001.'),
    'run': ('ToonamiMidnightRun200120024', 'Toonami Midnight Run', 'The overnight block, 2001-2002.'),
    'dbz244': ('videoplaytv-dragon-ball-z-episode-244', 'Dragon Ball Z', 'Episode 244, as aired on Toonami.'),
    # [adult swim]
    'as02': ('adult-swim-2002_202110', '[adult swim]', 'The block in its first years, 2002.'),
    'as04': ('adult-swim-2004', '[adult swim]', 'A night in 2004, with the commercials as they aired.'),
    'as04a': ('2021-11-10-17-08-35', '[adult swim]', 'Cartoon Network and Adult Swim anime, 2004.'),
    'as05': ('vhs-2005-jan-actn-adult-swim', '[adult swim] Action', 'The Saturday action block, January 2005.'),
    'as05b': ('oct22-2005', '[adult swim]', 'Saturday night, October 22, 2005.'),
    'as07': ('adult-swim-july-2007', '[adult swim]', 'Summer 2007, with commercials.'),
    # Nickelodeon
    'nk00': ('march-11-and-12-2000-nickelodeon', 'Nickelodeon', 'March 11 and 12, 2000, with commercials.'),
    'nk01a': ('2026-01-04-17-43-44-1', 'Nickelodeon', 'August 29, 2001, with commercials.'),
    'nk01b': ('spongebobsync', 'Nicktoons', 'SpongeBob, Invader Zim and more, October 2001.'),
    'nk01c': ('nickelodeon-nicktoons-2001-woc', 'Nicktoons: Wild Hair Day', 'August 25, 2001.'),
    'nk01d': ('2025-08-04-18-57-30-1', 'Nickelodeon', 'Summer 2001 on Nick.'),
    'nk02a': ('nickelodeon-march-1st-2002-woc', 'Nickelodeon', 'Friday, March 1, 2002.'),
    'nk02b': ('nickelodeonsummerbeachhouse2002spongebobpremiere', 'Nickelodeon Summer Beach House', 'Summer 2002, with a SpongeBob premiere.'),
    'nk03': ('nickelodeon-and-cartoon-network-vhs-2003', 'Nickelodeon', 'Nick in 2003.'),
    'snk98': ('snick-january-3-1998', 'SNICK', 'Saturday night, January 3, 1998.'),
    'snk02': ('vts-01-1_20260516_0606', 'SNICK', 'Saturday night, December 14, 2002.'),
    'teen01': ('teen-nick-2001', 'TEENick', 'Sunday night, 2001.'),
}


# Live channels from iptv-org (github.com/iptv-org/iptv), official free ad-supported
# streams only. Locals are on their broadcast numbers, as DirecTV carried them; the rest
# weren't DirecTV channels and sit at the end, from 700. They're live, so the guide shows hour blocks and there's no rewind
# past the moment you tuned in. Streams come and go; re-check with:
#   python3 tools/build_lineup.py --check-iptv
WEEKDAYS = [1, 2, 3, 4, 5]


def news(days, at, mins, title):
    # a newscast in a live channel's weekly guide (days: 0=Sun..6=Sat)
    return dict(days=days, at=at, mins=mins, t=title,
                s='Albuquerque and New Mexico news, weather and sports from KOAT Action 7 News.')


def pluto(channel_id):
    # A Pluto TV channel (free, no account). Its stream link needs a Pluto session, so the
    # server builds it at play time (pluto.js); a fixed link only gets a "not available" slate.
    return f'pluto:{channel_id}'


IPTV = [
    # Broadcast TV, New Mexico first. Only PBS streams its real schedule for free; KOAT
    # streams its newscasts. KOB 4, KRQE 13 and New Mexico PBS aren't streamed freely
    # (an antenna gets all of them). Numbered like locals at the top of the guide.
    dict(num='5', call='PBS', name='PBS', tagline="PBS's national schedule (Pacific feed). New Mexico PBS needs an antenna.",
         url='https://pbs.lls.cdn.pbs.org/pst/index.m3u8'),
    # KOAT's stream carries its live newscasts; between them it runs Hearst's "Very Local".
    # The guide shows the newscasts at their broadcast times (from KOAT's TV listings,
    # Mountain time) and Very Local in the gaps.
    dict(num='7', call='KOAT', name='KOAT Action 7 News', tagline="Albuquerque's ABC station: Action 7 News, and Very Local between newscasts.",
         url='https://aegis-cloudfront-1.tubi.video/2dba5dd9-4097-45e3-b169-56735cc48476/playlist.m3u8',
         guide=dict(tz='America/Denver',
                    filler=dict(t='Very Local', s='Hearst\'s Very Local: travel, food and stories from around the country, between KOAT newscasts.'),
                    slots=[
                        news(WEEKDAYS, '04:30', 30, 'KOAT Action 7 News More in the Morning'),
                        news(WEEKDAYS, '05:00', 120, 'KOAT Action 7 News More in the Morning'),
                        news(WEEKDAYS, '11:00', 60, 'KOAT Action 7 News Live at 11'),
                        news(WEEKDAYS, '16:00', 60, 'KOAT Action 7 News Live at 4'),
                        news(WEEKDAYS + [0], '17:00', 30, 'KOAT Action 7 News Live at 5'),
                        news(WEEKDAYS, '18:00', 30, 'KOAT Action 7 News Live at 6'),
                        news(WEEKDAYS, '22:00', 35, 'KOAT Action 7 News Live at 10'),
                        news([6], '05:00', 240, 'KOAT Action 7 News More in the Morning Saturday'),
                        news([0], '05:00', 240, 'KOAT Action 7 News More in the Morning Sunday'),
                        news([6], '22:00', 30, 'KOAT Action 7 News Live at 10'),
                        news([0], '22:00', 60, 'KOAT Action 7 News Live at 10'),
                    ])),
    dict(num='700', call='MST3K', name='Mystery Science Theater 3000', tagline='Joel, Mike and the bots riff on terrible movies.',
         url='https://d1c73nj8qxp55a.cloudfront.net/Mystery_Science_Theater_3000.m3u8'),
    dict(num='701', call='RIFFTRX', name='RiffTrax', tagline='The MST3K crew, still riffing.',
         url='https://wurlrifftrax.global.transmit.live/hls/68222b9cbe836edbe6f39e74/playlist.m3u8'),
    dict(num='702', call='DRWHO', name='Doctor Who Classic', tagline='The Doctor, 1963 to 1989.',
         url='https://bbc-classicdrwho-1-us.roku.wurl.tv/playlist.m3u8'),
    dict(num='703', call='SNL', name='SNL Vault', tagline='Saturday Night Live sketches from every era.',
         url='https://d4whmvwm0rdvi.cloudfront.net/10007/99993017/hls/master.m3u8?ads.xumo_channelId=99993017'),
    dict(num='704', call='AFV', name="America's Funniest Home Videos", tagline='Camcorders, crotch shots and cats.',
         url='https://linear-12.frequency.stream/dist/plex/12/hls/master/playlist.m3u8'),
    dict(num='705', call='RETRO', name='RetroCrush', tagline='Classic anime from the \'70s, \'80s and \'90s.',
         url='https://linear-899.frequency.stream/dist/cineverse/899/hls/master/playlist.m3u8'),
    dict(num='706', call='PULP', name='Midnight Pulp', tagline='Cult cinema, kung fu and grindhouse.',
         url='https://linear-897.frequency.stream/dist/cineverse/897/hls/master/playlist.m3u8'),
    dict(num='707', call='SHOUT', name='Shout! Factory TV', tagline='Cult TV and movies from the Shout! vault.',
         url='https://d1s1wrpgemt9re.cloudfront.net/Shout_TV.m3u8'),
    dict(num='708', call='ARCHIVE', name='The Archive', tagline='Classic television, all day.',
         url='https://linear-1080.frequency.stream/dist/cineverse/1080/hls/master/playlist.m3u8'),
    dict(num='709', call='ARTS', name='Classic Arts Showcase', tagline='Opera, ballet, jazz and film clips, no commercials.',
         url='https://classicarts.akamaized.net/hls/live/1024257/CAS/master.m3u8'),
    dict(num='710', call='ROADSHW', name='Antiques Roadshow', tagline='PBS appraisals: is it worth a fortune?',
         url='https://amg00953-pbsusa-antiroadshow-xumo-x6ud5.amagi.tv/playlist.m3u8'),
    dict(num='711', call='TRAVEL', name='Tastemade Travel', tagline='Food and places around the world.',
         url='https://d6ef3usc6d9cl.cloudfront.net/Tastemade_Travel.m3u8'),
    dict(num='712', call='SPACE', name='Space Live', tagline='Earth from orbit, live.',
         url='https://linear-1224.frequency.stream/dist/lg-uk/1224/hls/master/playlist.m3u8'),
    dict(num='713', call='NEWS', name='NBC News NOW', tagline='Live news, around the clock.',
         url='https://d1si3n1st4nkgb.cloudfront.net/10502/88896001/hls/master.m3u8?ads.xumo_channelId=88896001'),
    dict(num='714', call='WEATHR', name='WeatherNation', tagline='National and regional weather, live.',
         url='https://d2ferbiwcx1539.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-8zd06wicndthf-ssai-prd/WNNationalSamsung/WNNationalSamsung.m3u8'),
    # WCBS's local news stream, where DirecTV carried WCBS: 380, "CBS East", its distant
    # network feed (the CBS network itself is only on Paramount+)
    dict(num='380', call='WCBS', name='CBS 2 New York', tagline="CBS News New York: WCBS-TV's local news, live.",
         url=pluto('5dc9b8223687ff000936ed79')),
    # Toonami Aftermath: a fan-run Toonami revival (unofficial). The
    # West feed, an hour behind Mountain time, is closer to local than the East feed. It and the
    # anime channels after it aren't DirecTV channels, so they follow the other live ones.
    dict(num='724', call='TOONAMI', name='Toonami Aftermath', tagline='The Toonami block, revived by fans, around the clock.',
         url='http://api.toonamiaftermath.com:3000/pst/playlist.m3u8'),
    dict(num='725', call='POKEMON', name='Pokémon', tagline='Gotta catch \'em all, around the clock.',
         url=pluto('6675c7868768aa0008d7f1c7')),
    dict(num='726', call='YUGIOH', name='Yu-Gi-Oh!', tagline="It's time to duel.",
         url=pluto('5f4ec10ed9636f00089b8c89')),
    dict(num='715', call='COLDCSE', name='Cold Case Files', tagline="A&E's real detectives reopen the unsolved.",
         url=pluto('5c37d6712de254456f7ec340')),
    dict(num='716', call='FORENSC', name='Forensic Files', tagline='No witnesses, just the evidence.',
         url=pluto('5bb1af6a268cae539bcedb0a')),
    dict(num='717', call='HELLSKN', name="Gordon Ramsay's Hell's Kitchen", tagline='Yes, chef.',
         url=pluto('5b4e99f4423e067bd6df6903')),
    dict(num='718', call='DEGRASS', name='Degrassi', tagline='Growing up on Degrassi Street, every era.',
         url=pluto('5c6eeb85c05dfc257e5a50c4')),
    dict(num='719', call='PORTLND', name='Portlandia', tagline='Put a bird on it.',
         url='https://d1uvnirn6lhs2f.cloudfront.net/playlist.m3u8'),
    # cozy cooking, the 2000s kind
    dict(num='720', call='MARTHA', name='The Martha Stewart Channel', tagline='Martha Stewart Living and more. It\'s a good thing.',
         url=pluto('67c62ac2095aea2ec805eb34')),
    dict(num='721', call='GOODEAT', name='Good Eats', tagline="Alton Brown's Good Eats, from Food Network.",
         url=pluto('68bb16ba3efb41cd971f3ce6')),
    dict(num='722', call='ATK', name="America's Test Kitchen", tagline="America's Test Kitchen and Cook's Country.",
         url=pluto('5e84f54a82f05300080e6746')),
    dict(num='723', call='BBCFOOD', name='BBC Food', tagline='British cooking, from the BBC.',
         url='https://d1e9r0b71zfwk7.cloudfront.net/playlist.m3u8'),
]


# New Mexico radio, carried like the music channels on DirecTV: audio with a station card.
RADIO = [
    dict(num='801', call='KANW', name='KANW 89.1 FM', city='Albuquerque', tagline='Public radio: NPR news and New Mexico music.',
         url='https://playerservices.streamtheworld.com/api/livestream-redirect/KANWFM.mp3'),
    dict(num='802', call='KANW2', name='KANW-2 89.1 HD2', city='Albuquerque', tagline="KANW's second channel.",
         url='https://playerservices.streamtheworld.com/api/livestream-redirect/KANWHD2.mp3'),
    dict(num='803', call='KUNM', name='KUNM 89.9 FM', city='Albuquerque', tagline='Public radio from the University of New Mexico.',
         url='https://playerservices.streamtheworld.com/api/livestream-redirect/KUNMFM_128.mp3'),
    dict(num='804', call='KSFR', name='KSFR 101.1 FM', city='Santa Fe', tagline='Northern New Mexico public radio.',
         url='https://playerservices.streamtheworld.com/api/livestream-redirect/KSFRFM_ICE.aac'),
    dict(num='805', call='KHFM', name='KHFM 95.5 Classical', city='Albuquerque', tagline='Classical music for New Mexico.',
         url='https://live.amperwave.net/direct/agmedia28-khfmfmaac-ibc3'),
    dict(num='806', call='KRWG', name='KRWG 90.7 FM', city='Las Cruces', tagline='Public radio for southern New Mexico.',
         url='https://playerservices.streamtheworld.com/api/livestream-redirect/KRWGFMAAC'),
    dict(num='807', call='KNCE', name='KNCE 93.5 True Taos Radio', city='Taos', tagline='Independent radio from Taos.',
         url='https://shoutcast.brownrice.com:8002/stream'),
]



# ── The Weather Channel ───────────────────────────────────────────────────────
# A WeatherStar-style local forecast loop, live from the National Weather Service,
# with the Trammell Starks music it played under. home: the city the current
# conditions, local and extended forecasts are for. Each city's groups say where
# it shows: 'north' / 'state' observation lists, 'radar' map labels, 'region'
# forecast map (listed in priority order; crowded labels drop out).
def city(name, lat, lon, *groups, station=None):
    # station: an NWS observing station to use instead of the nearest airport, or 'grid'
    # for a village with none nearby: NWS's hourly forecast for right now, at that spot
    return dict(name=name, lat=lat, lon=lon, groups=list(groups), **({'station': station} if station else {}))


WEATHER = dict(
    num='362', call='TWC', name='The Weather Channel', logo='TWC.svg', home='Santa Fe', tz='America/Denver',
    music='sounds/trammell',
    tagline='Local forecasts for northern New Mexico, around the clock.',
    desc='Current conditions, radar, the local and extended forecast and the almanac for Santa Fe and northern '
         'New Mexico, live from the National Weather Service.',
    maps={'radar': [-109.57, 34.6, -102.43, 37.5], 'region': [-113.95, 31.0, -98.05, 37.6]},
    # today's horoscopes, in the crawl along the bottom
    horoscopes=[dict(sign='Leo', dates='Jul 23 - Aug 22'), dict(sign='Aquarius', dates='Jan 20 - Feb 18')],
    cities=[
        city('Santa Fe', 35.687, -105.938, 'north', 'radar'),
        city('Albuquerque', 35.084, -106.651, 'state', 'radar', 'region'),
        city('Taos', 36.407, -105.573, 'north', 'radar', station='F0064'),
        city('El Rito', 36.337, -106.188, 'north', station='grid'),
        city('La Madera', 36.387, -106.043, 'north', station='grid'),
        city('Vallecitos', 36.495, -106.117, 'north', station='grid'),
        city('Española', 35.991, -106.080, 'north', station='G1362'),
        city('Abiquiu', 36.209, -106.320, 'north', station='grid'),
        city('Las Vegas', 35.594, -105.224, 'radar'),
        city('Raton', 36.903, -104.439, 'radar', 'region'),
        city('Farmington', 36.728, -108.219, 'state', 'radar', 'region'),
        city('Gallup', 35.528, -108.743, 'state', 'radar', 'region'),
        city('Tucumcari', 35.172, -103.725, 'state', 'radar', 'region'),
        city('Chama', 36.903, -106.579, 'radar', station='CHMN5'),
        city('Clayton', 36.452, -103.184, 'radar'),
        city('Grants', 35.147, -107.851, 'radar'),
        city('Santa Rosa', 34.938, -104.682, 'radar'),
        city('Roswell', 33.394, -104.523, 'state', 'region'),
        city('Las Cruces', 32.312, -106.778, 'state', 'region'),
        city('Silver City', 32.770, -108.280, 'state', 'region'),
        city('Carlsbad', 32.421, -104.229, 'region'),
        city('Socorro', 34.058, -106.891, 'region'),
        city('Clovis', 34.405, -103.205, 'region'),
        city('Durango', 37.275, -107.880, 'region'),
        city('Alamosa', 37.469, -105.870, 'region'),
        city('Flagstaff', 35.198, -111.651, 'region'),
        city('Amarillo', 35.222, -101.831, 'region'),
        city('Lubbock', 33.578, -101.855, 'region'),
        city('El Paso', 31.762, -106.485, 'region'),
        city('Tucson', 32.222, -110.975, 'region'),
    ],
)


# ── Dirty's Golf Weather: golf weather for the city courses ───────────────────
# Channel 8, beside the Golf Channel on 9, branded for Dirty's Golf Shop. How Albuquerque's municipal golf courses are playing right now, worked
# out from live National Weather Service data, with flyovers of the holes drawn as vectors
# from OpenStreetMap, in the same '90s cable-graphics style as The Weather Channel on 362. Courses: OpenGolfAPI scorecards (opengolf: its course id), OpenStreetMap hole
# lines (osm: the course outline's way id). tools/golf_data.py puts them together.
GOLF_WEATHER = dict(
    num='8', call='DIRTYS', name="Dirty's Golf Weather", logo='DIRTYS.jpg', tz='America/Denver',
    area='Albuquerque City Courses',  # the title card's subtitle
    music='sounds/trammell',
    tagline="How Albuquerque's city golf courses are playing, from live weather.",
    desc='Golf weather for the City of Albuquerque courses: current conditions, how the courses are playing, '
         'tee-time forecasts and hole flyovers, live from the National Weather Service.',
    # the Sunport, for the citywide conditions
    home=dict(name='Albuquerque', lat=35.0402, lon=-106.6094, station='KABQ'),
    courses=[
        dict(key='oso', name='Arroyo del Oso', opengolf='5a302d90-e918-44f0-b546-272d3f92d352', osm=167529001),
        dict(key='ladera', name='Ladera', opengolf='cd5741fd-5d55-4ead-8bbb-71b84f985c90', osm=171463337),
        dict(key='losaltos', name='Los Altos', opengolf='9b47e703-fcd5-4f22-b6f6-8480dc69a9e9', osm=48475012),
        dict(key='puerto', name='Puerto del Sol', opengolf='c91b1f31-0498-4a32-8a25-60af357f1522', osm=164982330),
    ],
)
