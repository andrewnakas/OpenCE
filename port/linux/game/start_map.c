/* game.start_map and game.test_script (web): a campaign level in place of the
main menu, under a player profile so checkpoints and level progress are saved,
and script commands at set times for the automated checks. */
#ifdef HALO_WEB

#include "cseries.h"
#include "main/main.h"
#include "interface/player_ui.h"
#include "game/game.h"
#include "hs/hs.h"
#include "saved games/player_profile.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

const char *config_string(const char *name);

enum
{
	MAXIMUM_START_PROFILES = 64,
	MAXIMUM_TEST_COMMANDS = 16,
};

/* the first profile of this browser, or a new one named Player */
static boolean start_map_choose_profile(void)
{
	word count = 0;
	long indices[MAXIMUM_START_PROFILES];
	long profile_index = NONE;
	struct player_profile profile;
	static wchar_t name[] = L"Player";

	player_ui_set_single_player_local_player_controller(0, 0);
	player_profiles_enumerate_available_to_local_player_index(0, &count, indices, FALSE);
	if (count > 0)
	{
		profile_index = indices[0];
	}
	else
	{
		profile_index = player_profile_new(0, name);
	}
	if (profile_index == NONE || !player_profile_get(profile_index, &profile))
	{
		return FALSE;
	}
	player_ui_set_active_player_profile(0, profile_index, &profile);

	return TRUE;
}

void start_map_begin(const char *level)
{
	static char scenario[128];

	if (!start_map_choose_profile())
	{
		error(2, "start_map: no player profile; progress is not saved");
	}
	snprintf(scenario, sizeof(scenario), "levels\\%s\\%s", level, level);
	main_set_difficulty(1);
	main_set_map_name(scenario);
	game_connection_set(0);
	main_menu_switch_to_single_player();
}

/* game.test_script "5:cheat_deathless_player 1;60:game_won": each command runs
once, that many seconds of game time into the first level played */
void start_map_update(boolean main_menu_loaded)
{
	static boolean parsed;
	static char text[512];
	static struct { long tick; char *command; boolean done; } commands[MAXIMUM_TEST_COMMANDS];
	static short command_count;
	short index;

	if (!parsed)
	{
		char *cursor;

		parsed = TRUE;
		strncpy(text, config_string("game.test_script"), sizeof(text) - 1);
		for (cursor = strtok(text, ";"); cursor && command_count < MAXIMUM_TEST_COMMANDS; cursor = strtok(NULL, ";"))
		{
			char *colon = strchr(cursor, ':');

			if (colon)
			{
				*colon = 0;
				commands[command_count].tick = (long)(atof(cursor) * 30.0);
				commands[command_count].command = colon + 1;
				command_count++;
			}
		}
	}
	if (!command_count || main_menu_loaded || !game_in_progress())
	{
		return;
	}
	for (index = 0; index < command_count; index++)
	{
		if (!commands[index].done && game_time_get() >= commands[index].tick)
		{
			commands[index].done = TRUE;
			error(2, "test_script: %s", commands[index].command);
			hs_compile_and_evaluate(commands[index].command);
		}
	}
}

#endif
