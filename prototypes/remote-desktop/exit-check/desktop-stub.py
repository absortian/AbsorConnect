#!/usr/bin/env python3
# Escritorio mínimo para las pruebas en un Linux sin shell de escritorio (p. ej. Cinnamon caído):
# el servicio de notificaciones y el StatusNotifierWatcher de la bandeja, solo los que falten. Así
# la app ve una bandeja y puede mostrar notificaciones, y la prueba las lee por D-Bus. Escribe cada
# notificación en la salida estándar como una línea JSON. Termina con SIGTERM.
import json
import signal
import sys

import gi

gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib  # noqa: E402

NOTIFICATIONS = 'org.freedesktop.Notifications'
WATCHER = 'org.kde.StatusNotifierWatcher'

NOTIFICATIONS_XML = """
<node><interface name="org.freedesktop.Notifications">
  <method name="Notify">
    <arg type="s" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="in"/>
    <arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="as" direction="in"/>
    <arg type="a{sv}" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="out"/>
  </method>
  <method name="CloseNotification"><arg type="u" direction="in"/></method>
  <method name="GetCapabilities"><arg type="as" direction="out"/></method>
  <method name="GetServerInformation">
    <arg type="s" direction="out"/><arg type="s" direction="out"/>
    <arg type="s" direction="out"/><arg type="s" direction="out"/>
  </method>
  <signal name="NotificationClosed"><arg type="u"/><arg type="u"/></signal>
  <signal name="ActionInvoked"><arg type="u"/><arg type="s"/></signal>
</interface></node>
"""

WATCHER_XML = """
<node><interface name="org.kde.StatusNotifierWatcher">
  <method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
  <method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
  <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
  <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
  <property name="ProtocolVersion" type="i" access="read"/>
  <signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
  <signal name="StatusNotifierItemUnregistered"><arg type="s"/></signal>
  <signal name="StatusNotifierHostRegistered"/>
</interface></node>
"""

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
items = []
next_id = [1]


def has_owner(name):
    reply = bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                          'NameHasOwner', GLib.Variant('(s)', (name,)), None,
                          Gio.DBusCallFlags.NONE, -1, None)
    return reply.unpack()[0]


def notifications_call(connection, sender, path, interface, method, params, invocation):
    if method == 'Notify':
        app, _replaces, _icon, summary, body = params.unpack()[:5]
        print(json.dumps({'app': app, 'summary': summary, 'body': body}, ensure_ascii=False),
              flush=True)
        invocation.return_value(GLib.Variant('(u)', (next_id[0],)))
        next_id[0] += 1
    elif method == 'GetCapabilities':
        invocation.return_value(GLib.Variant('(as)', (['body', 'actions'],)))
    elif method == 'GetServerInformation':
        invocation.return_value(GLib.Variant('(ssss)', ('desktop-stub', 'absor', '1', '1.2')))
    else:
        invocation.return_value(None)


def watcher_call(connection, sender, path, interface, method, params, invocation):
    if method == 'RegisterStatusNotifierItem':
        service = params.unpack()[0]
        # Según la especificación, una ruta de objeto va con el nombre de quien llama
        item = sender + service if service.startswith('/') else service
        if item not in items:
            items.append(item)
            connection.emit_signal(None, '/StatusNotifierWatcher', WATCHER,
                                   'StatusNotifierItemRegistered', GLib.Variant('(s)', (item,)))
    invocation.return_value(None)


def watcher_property(connection, sender, path, interface, name):
    if name == 'RegisteredStatusNotifierItems':
        return GLib.Variant('as', items)
    if name == 'IsStatusNotifierHostRegistered':
        return GLib.Variant('b', True)
    return GLib.Variant('i', 0)


def forget_item(connection, sender, path, interface, signal_name, params):
    name, _old, new = params.unpack()
    if new:
        return
    for item in [i for i in items if i == name or i.startswith(name + '/')]:
        items.remove(item)
        connection.emit_signal(None, '/StatusNotifierWatcher', WATCHER,
                               'StatusNotifierItemUnregistered', GLib.Variant('(s)', (item,)))


offered = []
if not has_owner(NOTIFICATIONS):
    info = Gio.DBusNodeInfo.new_for_xml(NOTIFICATIONS_XML).interfaces[0]
    bus.register_object('/org/freedesktop/Notifications', info, notifications_call, None, None)
    Gio.bus_own_name_on_connection(bus, NOTIFICATIONS, Gio.BusNameOwnerFlags.NONE, None, None)
    offered.append('notificaciones')
if not has_owner(WATCHER):
    info = Gio.DBusNodeInfo.new_for_xml(WATCHER_XML).interfaces[0]
    bus.register_object('/StatusNotifierWatcher', info, watcher_call, watcher_property, None)
    bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
                         '/org/freedesktop/DBus', None, Gio.DBusSignalFlags.NONE, forget_item)
    Gio.bus_own_name_on_connection(bus, WATCHER, Gio.BusNameOwnerFlags.NONE, None, None)
    offered.append('bandeja')

print(json.dumps({'offered': offered}), flush=True)
loop = GLib.MainLoop()
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, loop.quit)
loop.run()
sys.exit(0)
