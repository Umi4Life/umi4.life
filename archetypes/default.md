+++
date = '{{ .Date }}'
draft = true
title = '{{ replace .File.ContentBaseName "-" " " | title }}'
description = ''
translationKey = '{{ .File.ContentBaseName }}'
tags = []
categories = []
# Full image URL (e.g. raw.githubusercontent.com/...); Reimu does not resolve local bundle paths
cover = ''
banner = ''
mermaid = true
+++
