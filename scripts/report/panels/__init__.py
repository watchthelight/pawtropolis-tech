"""Analytics panel registry.

Order here is the order the sheets appear in the workbook, after the table of
contents and before the raw dump tier.
"""

from panels import (
    applications, economy, invites, members, messages, moderation, modmail,
    overview, security, voice,
)

PANELS = [
    ("overview", overview.build),
    ("members", members.build),
    ("invites", invites.build),
    ("messages", messages.build),
    ("moderation", moderation.build),
    ("applications", applications.build),
    ("modmail", modmail.build),
    ("voice", voice.build),
    ("economy", economy.build),
    ("security", security.build),
]

# Tables whose content is represented by the analytics panels above, so the raw
# dump tier can skip them rather than emit an unopenable sheet.
COVERED_BY_PANELS = {"messages_archive"}
