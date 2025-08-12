trade endpoint /trade-values
{
  "nodeAId": "string",
  "versionAIndex": 0,
  "valuesA": { "key1": 10, "key2": 5 },
  "nodeBId": "string",
  "versionBIndex": 1,
  "valuesB": { "key1": 7, "key2": 3 }
}






/hold children data
/*
    {
      id: generateId(),
      name: "Wealth",
      prestige: 0,
      globalValues: { dollars: 0 }, // Track total values across all versions
      versions: [
        {
          prestige: 0,
          values: { dollars: 0 },
          status: "exchange",
          dateCreated: new Date().toISOString(),
          schedule: null,
          reeffectTime: 0,
        },
      ],
      children: [],
    },
    {
      id: generateId(),
      name: "Self Focused",
      prestige: 0,
      globalValues: {},
      versions: [
        {
          prestige: 0,
          values: {},
          status: "exchange",
          dateCreated: new Date().toISOString(),
          schedule: null,
          reeffectTime: 0,
        },
      ],
      children: [
        {
          id: generateId(),
          name: "Body",
          prestige: 0,
          globalValues: {},
          versions: [
            {
              prestige: 0,
              values: {},
              status: "exchange",
              dateCreated: new Date().toISOString(),
              schedule: null,
              reeffectTime: 0,
            },
          ],
          children: [],
        },
        {
          id: generateId(),
          name: "Mind",
          prestige: 0,
          globalValues: {},
          versions: [
            {
              prestige: 0,
              values: {},
              status: "exchange",
              dateCreated: new Date().toISOString(),
              schedule: null,
              reeffectTime: 0,
            },
          ],
          children: [],
        },
      ],
    },
    {
      id: generateId(),
      name: "Other Focused",
      prestige: 0,
      globalValues: {},
      versions: [
        {
          prestige: 0,
          values: {},
          status: "exchange",
          dateCreated: new Date().toISOString(),
          schedule: null,
          reeffectTime: 0,
        },
      ],
      children: [
        {
          id: generateId(),
          name: "People",
          prestige: 0,
          globalValues: {},
          versions: [
            {
              prestige: 0,
              values: {},
              status: "exchange",
              dateCreated: new Date().toISOString(),
              schedule: null,
              reeffectTime: 0,
            },
          ],
          children: [],
        },
        {
          id: generateId(),
          name: "Possessions",
          prestige: 0,
          globalValues: {},
          versions: [
            {
              prestige: 0,
              values: {},
              status: "exchange",
              dateCreated: new Date().toISOString(),
              schedule: null,
              reeffectTime: 0,
            },
          ],
          children: [],
        },
        {
          id: generateId(),
          name: "Expression",
          prestige: 0,
          globalValues: {},
          versions: [
            {
              prestige: 0,
              values: {},
              status: "exchange",
              dateCreated: new Date().toISOString(),
              schedule: null,
              reeffectTime: 0,
            },
          ],
          children: [],
        },
      ],
    },
  */


    example json to send to endpoint
    {
      "parentId": "fa553651-1d20-4f21-b4ec-267461f86328",
      "nodeTree": {
        "name": "Brush Teeth Routine",
        "schedule": "2024-12-01T07:00:00Z",
        "reeffectTime": 0,
        "children": [
          {
            "name": "Prepare Supplies",
            "schedule": "2024-12-01T07:00:00Z",
            "reeffectTime": 1,
            "children": [
              {
                "name": "Retrieve Toothbrush",
                "schedule": "2024-12-01T07:00:30Z",
                "reeffectTime": 0.5
              },
              {
                "name": "Apply Toothpaste",
                "schedule": "2024-12-01T07:01:00Z",
                "reeffectTime": 0.5
              }
            ]
          },
          {
            "name": "Brush Teeth",
            "schedule": "2024-12-01T07:02:00Z",
            "reeffectTime": 2,
            "children": [
              {
                "name": "Brush Upper Teeth",
                "schedule": "2024-12-01T07:02:00Z",
                "reeffectTime": 1
              },
              {
                "name": "Brush Lower Teeth",
                "schedule": "2024-12-01T07:03:00Z",
                "reeffectTime": 1
              }
            ]
          },
          {
            "name": "Rinse and Clean Up",
            "schedule": "2024-12-01T07:04:00Z",
            "reeffectTime": 1,
            "children": [
              {
                "name": "Rinse Mouth",
                "schedule": "2024-12-01T07:04:00Z",
                "reeffectTime": 0.5
              },
              {
                "name": "Clean Toothbrush",
                "schedule": "2024-12-01T07:04:30Z",
                "reeffectTime": 0.5
              }
            ]
          }
        ]
      }
    }
    




    {
      "parentId": "2dd7ba96-ff6b-4215-bab6-7ec7ca698fb3",
      "nodeTree": {
        "name": "Meditation Routine",
        "schedule": "2024-12-01T08:00:00Z",
        "reeffectTime": 0,
        "children": [
          {
            "name": "Prepare for Meditation",
            "schedule": "2024-12-01T08:00:00Z",
            "reeffectTime": 5,
            "children": [
              {
                "name": "Find a Comfortable Space",
                "schedule": "2024-12-01T08:00:00Z",
                "reeffectTime": 2
              },
              {
                "name": "Sit in a Comfortable Posture",
                "schedule": "2024-12-01T08:02:00Z",
                "reeffectTime": 2
              },
              {
                "name": "Set an Intention for the Session",
                "schedule": "2024-12-01T08:04:00Z",
                "reeffectTime": 1
              },
              {
                "name": "Close Your Eyes and Relax",
                "schedule": "2024-12-01T08:05:00Z",
                "reeffectTime": 1
              }
            ]
          },
          {
            "name": "Metta (Loving Kindness) Meditation",
            "schedule": "2024-12-01T08:06:00Z",
            "reeffectTime": 10,
            "children": [
              {
                "name": "Focus on Yourself",
                "schedule": "2024-12-01T08:06:00Z",
                "reeffectTime": 2,
                "children": [
                  {
                    "name": "Repeat the Phrases: 'May I be happy, May I be healthy, May I be safe, May I live with ease'",
                    "schedule": "2024-12-01T08:06:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Visualize Yourself Filled with Love and Kindness",
                    "schedule": "2024-12-01T08:07:30Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Feel Warmth in Your Heart Space",
                    "schedule": "2024-12-01T08:09:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Hold Compassion for Yourself",
                    "schedule": "2024-12-01T08:10:30Z",
                    "reeffectTime": 1
                  }
                ]
              },
              {
                "name": "Expand Loving Kindness to Others",
                "schedule": "2024-12-01T08:11:00Z",
                "reeffectTime": 4,
                "children": [
                  {
                    "name": "Send Loving Kindness to Loved Ones",
                    "schedule": "2024-12-01T08:11:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Send Loving Kindness to Neutral People",
                    "schedule": "2024-12-01T08:12:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Send Loving Kindness to Challenging People",
                    "schedule": "2024-12-01T08:13:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Expand Loving Kindness to All Beings",
                    "schedule": "2024-12-01T08:14:00Z",
                    "reeffectTime": 1
                  }
                ]
              }
            ]
          },
          {
            "name": "Focus Meditation",
            "schedule": "2024-12-01T08:15:00Z",
            "reeffectTime": 15,
            "children": [
              {
                "name": "Focus on Breath",
                "schedule": "2024-12-01T08:15:00Z",
                "reeffectTime": 5,
                "children": [
                  {
                    "name": "Inhale Deeply, Feel the Air Enter Your Body",
                    "schedule": "2024-12-01T08:15:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Exhale Slowly, Let Go of Tension",
                    "schedule": "2024-12-01T08:16:30Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Focus on the Natural Flow of Breath",
                    "schedule": "2024-12-01T08:18:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Bring Awareness to the Space Between Breaths",
                    "schedule": "2024-12-01T08:19:30Z",
                    "reeffectTime": 1
                  }
                ]
              },
              {
                "name": "Focus on a Word or Mantra",
                "schedule": "2024-12-01T08:20:00Z",
                "reeffectTime": 4,
                "children": [
                  {
                    "name": "Choose a Word or Phrase",
                    "schedule": "2024-12-01T08:20:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Repeat the Word Silently in Your Mind",
                    "schedule": "2024-12-01T08:21:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Allow the Word to Bring You into Present Awareness",
                    "schedule": "2024-12-01T08:22:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Notice the Impact of the Word on Your Mind and Body",
                    "schedule": "2024-12-01T08:23:00Z",
                    "reeffectTime": 1
                  }
                ]
              },
              {
                "name": "Focus on Visuals or Images",
                "schedule": "2024-12-01T08:24:00Z",
                "reeffectTime": 3,
                "children": [
                  {
                    "name": "Visualize a Peaceful Place",
                    "schedule": "2024-12-01T08:24:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Focus on the Details of the Image",
                    "schedule": "2024-12-01T08:25:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Allow the Image to Expand and Fill Your Mind",
                    "schedule": "2024-12-01T08:26:00Z",
                    "reeffectTime": 1
                  }
                ]
              },
              {
                "name": "Return to the Present Moment",
                "schedule": "2024-12-01T08:27:00Z",
                "reeffectTime": 3,
                "children": [
                  {
                    "name": "Notice Any Distractions or Thoughts",
                    "schedule": "2024-12-01T08:27:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Gently Let Go of Distractions",
                    "schedule": "2024-12-01T08:28:00Z",
                    "reeffectTime": 1
                  },
                  {
                    "name": "Refocus on the Breath or Mantra",
                    "schedule": "2024-12-01T08:29:00Z",
                    "reeffectTime": 1
                  }
                ]
              }
            ]
          },
          {
            "name": "Body Awareness Meditation",
            "schedule": "2024-12-01T08:30:00Z",
            "reeffectTime": 15,
            "children": [
              {
                "name": "Scan the Body from Head to Toe",
                "schedule": "2024-12-01T08:30:00Z",
                "reeffectTime": 5,
                "children": [
                  {
                    "name": "Focus on the Sensations in Your Head and Neck",
                    "schedule": "2024-12-01T08:30:00Z",
                    "reeffectTime": 1.5
                  },
                  {
                    "name": "Move Awareness to Your Shoulders and Arms",
                    "schedule": "2024-12-01T08:31:30Z",
                    "reeffectTime": 1.5
                  },
                  {
                    "name": "Bring Attention to Your Chest and Back",
                    "schedule": "2024-12-01T08:33:00Z",
                    "reeffectTime": 1.5
                  },
                  {
                    "name": "Notice Sensations in Your Abdomen and Hips",
                    "schedule": "2024-12-01T08:34:30Z",
                    "reeffectTime": 1.5
                  }
                ]
              },
              {
                "name": "Focus on Each Limb and Joint",
                "schedule": "2024-12-01T08:35:00Z",
                "reeffectTime": 5,
                "children": [
                  {
                    "name": "Feel the Sensations in Your Legs and Knees",
                    "schedule": "2024-12-01T08:35:00Z",
                    "reeffectTime": 1.5
                  },
                  {
                    "name": "Bring Attention to Your Feet and Toes",
                    "schedule": "2024-12-01T08:36:30Z",
                    "reeffectTime": 1.5
                  },
                  {
                    "name": "Scan the Sensations in Your Hands and Wrists",
                    "schedule": "2024-12-01T08:38:00Z",
                    "reeffectTime": 1.5
                  },
                  {
                    "name": "Notice the Feelings in Your Neck and Spine",
                    "schedule": "2024-12-01T08:39:30Z",
                    "reeffectTime": 1.5
                  }
                ]
              },
              {
                "name": "Release Tension in Each Area",
                "schedule": "2024-12-01T08:40:00Z",
                "reeffectTime": 5,
                "children": [
                  {
                    "name": "Let Go of Tension in Your Shoulders",
                    "schedule": "2024-12-01T08:40:00Z",
                    "reeffectTime": 1.5
                  },
                  {
                    "name": "Release Tension in Your Hands and Feet",
                    "schedule": "2024-12-01T08:41:30Z",
                    "reeffectTime": 1.5
                  },
                  {
                    "name": "Relax Your Neck and Jaw",
                    "schedule": "2024-12-01T08:43:00Z",
                    "reeffectTime": 1.5
                  },
                  {
                    "name": "Allow Your Spine to Relax",
                    "schedule": "2024-12-01T08:44:30Z",
                    "reeffectTime": 1.5
                  }
                ]
              }
            ]
          },
          {
            "name": "Close the Session",
            "schedule": "2024-12-01T08:45:00Z",
            "reeffectTime": 5,
            "children": [
              {
                "name": "Reflect on the Practice",
                "schedule": "2024-12-01T08:45:00Z",
                "reeffectTime": 2
              },
              {
                "name": "Gradually Open Your Eyes",
                "schedule": "2024-12-01T08:47:00Z",
                "reeffectTime": 1
              },
              {
                "name": "Take a Few Deep Breaths",
                "schedule": "2024-12-01T08:48:00Z",
                "reeffectTime": 1
              },
              {
                "name": "Gently Transition to the Rest of Your Day",
                "schedule": "2024-12-01T08:49:00Z",
                "reeffectTime": 1
              }
            ]
          }
        ]
      }
    }
    